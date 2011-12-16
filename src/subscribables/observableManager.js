ko.uid = (function () {
    var counter = 0;

    function next() {
        return "" + counter++;
    }

    return {
        next: next,
        dub: function (o) {
            o.__ko_uid__ = next();
        },
        of: function (o) {
            return o.__ko_uid__;
        }
    };
}());

ko.abstractObservableManager = {
    independentNodeAccessor: function (args) {
        if (Object.prototype.hasOwnProperty.call(args, "newValue")) {
            // Write
            if (args.allowWrite(args)) {
                args.accessor(args.newValue);
                args.afterWrite(args);
            }
            return this; // Permits chained assignments
        } else {
            // Read
            // The caller only needs to be notified of changes if they did a "read" operation
            ko.dependencyDetection.registerDependency(args.observable);
            return args.accessor();
        }
    },
    dependentNodeAccessor: function (args) {
        if (Object.prototype.hasOwnProperty.call(args, "valueToWrite")) {
            if (typeof args.options["write"] === "function") {
                // Writing a value
                args.options["write"].call(args.options["owner"] || null, args.valueToWrite);
            } else {
                throw "Cannot write a value to a dependentObservable unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.";
            }
        } else {
            // Reading the value
            if (!args._hasBeenEvaluated)
                args.evaluate();
            ko.dependencyDetection.registerDependency(args.dependentObservable);
            return args.accessor();
        }
    },
    rebindingBroadcast: function (args) {
        args.observable.notifySubscribers(args.accessor());
    },
    compositeMutationBroadcast: function (args) {
        args.observable.notifySubscribers(args.accessor());
    },
    reevaluationBroadcast: function (args) {
        args.observable.notifySubscribers(args.accessor());
    }
};

ko.defaultObservableManager = {
    independentNodeAccessor: function (args) {
        var delegateArgs = ko.utils.extend({}, args);
        delegateArgs.afterWrite = ko.abstractObservableManager.rebindingBroadcast;
        return ko.abstractObservableManager.independentNodeAccessor.call(this, delegateArgs);
    },
    dependentNodeAccessor: ko.abstractObservableManager.dependentNodeAccessor,
    rebindingBroadcast: ko.abstractObservableManager.rebindingBroadcast,
    compositeMutationBroadcast: ko.abstractObservableManager.compositeMutationBroadcast,
    reevaluationBroadcast: ko.abstractObservableManager.reevaluationBroadcast
};

ko.newAtomicObservableManager = function () {
    var statefulApi,
        nullFn = function () { },
    // Collections for the write and commit phases
        cache,
        writePhaseCompositeMutationBroadcasts,
    // Collections for the commit and publish phases
        downstream,
        autonomousListeners,
    // Collections for the publish phase
        evaluated,
    // Collections for the publish and (next) write phases
        publishPhaseRebindings,
        publishPhaseCompositeMutationBroadcasts;

    function setUpWritePhase() {
        cache = {};
        writePhaseCompositeMutationBroadcasts = [];
        evaluated = null;
        statefulApi.independentNodeAccessor = writePhaseIndependentNodeAccessor;
        statefulApi.dependentNodeAccessor = ko.abstractObservableManager.dependentNodeAccessor;
        statefulApi.compositeMutationBroadcast = writePhaseCompositeMutationBroadcast;
        statefulApi.rebindingBroadcast = null; // does not occur
        statefulApi.reevaluationBroadcast = nullFn;

        autonomousListeners = [];
        downstream = {};
    }

    function writePhaseIndependentNodeAccessor(args) {
        var delegateArgs = ko.utils.extend({}, args);
        delegateArgs.afterWrite = interceptPublication;
        return ko.abstractObservableManager.independentNodeAccessor.call(this, delegateArgs);
    }

    function writePhaseCompositeMutationBroadcast(args) {
        writePhaseCompositeMutationBroadcasts.push(args);
    }

    function setUpPublishPhase() {
        evaluated = {};
        publishPhaseRebindings = [];
        publishPhaseCompositeMutationBroadcasts = [];
        cache = null;
        writePhaseCompositeMutationBroadcasts = null;
        statefulApi.independentNodeAccessor = publishPhaseIndependentNodeAccessor;
        statefulApi.dependentNodeAccessor = publishPhaseDependentNodeAccessor;
        statefulApi.compositeMutationBroadcast = publishPhaseCompositeMutationBroadcast;
        statefulApi.reevaluationBroadcast = nullFn;
        statefulApi.rebindingBroadcast = null; // does not occur
    }

    function publishPhaseIndependentNodeAccessor(args) {
        var delegateArgs = ko.utils.extend({}, args);
        delegateArgs.afterWrite = function (args) {
            publishPhaseRebindings.push(args);
        };
        return ko.abstractObservableManager.independentNodeAccessor.call(this, delegateArgs);
    }

    function publishPhaseDependentNodeAccessor(args) {
        var callbackUid = ko.uid.of(args.evaluate), delegateArgs;
        if (Object.prototype.hasOwnProperty.call(args, "valueToWrite") ||
                !Object.prototype.hasOwnProperty.call(downstream, callbackUid) ||
                Object.prototype.hasOwnProperty.call(evaluated, callbackUid)) {
            // 1.  Writes to dependent nodes execute normally (because they have no direct effect)
            // 2.  Reads of dependent nodes which are not downstream execute normally
            // 3.  Reads of already-evaluated downstream dependent nodes execute normally
            delegateArgs = args;
        } else {
            // 4.  Reads of downstream dependent nodes trigger evaluation the first time
            evaluated[callbackUid] = null;
            delegateArgs = ko.utils.extend({}, args);
            delegateArgs._hasBeenEvaluated = false;
        }
        return ko.abstractObservableManager.dependentNodeAccessor(delegateArgs);
    }

    function publishPhaseCompositeMutationBroadcast(args) {
        publishPhaseCompositeMutationBroadcasts.push(args);
    }

    function interceptPublication(args) {
        try {
            var subscribable = args.observable, accessor = args.accessor;
            ko.utils.arrayForEach(subscribable.getSubscriptions(), function (subscription) {
                var callback = subscription.callback,
                    callbackUid = ko.uid.of(callback);
                if (callbackUid == null) {
                    autonomousListeners.push({
                        callback: callback,
                        accessor: accessor
                    });
                } else if (!Object.prototype.hasOwnProperty.call(downstream, callbackUid)) {
                    downstream[callbackUid] = {
                        evaluate: callback
                    };
                    // Recursively collect all transitive observers.  We cheat and pass in the
                    // dependentObservable as the (direct) accessor.  By the time it would be
                    // invoked, after downstream reevaluation, its net effect is the same.  This
                    // works, but is suboptimal.  The alternative would be to add a second property
                    // to the callback, something like "parentAccessor".
                    interceptPublication({
                        observable: callback.parentDependentObservable,
                        accessor: callback.parentDependentObservable
                    });
                }
            });
        } catch (ex) { console.error(ex, ex.stack); }
    }

    function commit() {
        do {
            // Commit the new values while intercepting publication
            ko.utils.objectForEach(cache, function (observableUid, o) {
                var delegateArgs = ko.utils.extend({}, o);
                delegateArgs.afterWrite = interceptPublication;
                return ko.abstractObservableManager.independentNodeAccessor.call(this, delegateArgs);
            });

            // Transform the intercepted broadcasts into additional intercepted publications
            ko.utils.arrayForEach(writePhaseCompositeMutationBroadcasts, function (o) {
                interceptPublication(o);
            });

            setUpPublishPhase();

            // Trigger evaluation of all downstream dependent nodes
            ko.utils.objectForEach(downstream, function (callbackUid, o) {
                if (!Object.prototype.hasOwnProperty.call(evaluated, callbackUid)) {
                    evaluated[callbackUid] = null;
                    o.evaluate();
                }
            });

            // Notify all autonomous listeners
            ko.utils.arrayForEach(autonomousListeners, function (o) {
                o.callback(o.accessor());
            });

            // If any additional mutation of independent nodes was intercepted during the commit
            // we must repeat the whole process.
            if (publishPhaseRebindings.length || publishPhaseCompositeMutationBroadcasts.length) {
                setUpWritePhase();

                ko.utils.arrayForEach(publishPhaseRebindings, function (args) {
                    interceptPublication(args);
                });
                ko.utils.arrayForEach(publishPhaseCompositeMutationBroadcasts, function (o) {
                    ko.observableManager.compositeMutationBroadcast(o);
                });
            } else {
                break;
            }
        } while(true);
    }

    statefulApi = {
        commit: commit
    };
    setUpWritePhase();

    return statefulApi;
};

ko.observableManager = ko.defaultObservableManager;

ko.atomically = (function () {
    // We do not allow nested transactions because we cannot scope the
    // publications of an inner transaction.  Instead, reentrant invocations of
    // atomically() are coalesced.
    var withinTransaction = false;
    return function (fn) {
        if (withinTransaction) {
            fn();
            return;
        }
        var atomicObservableManager = ko.observableManager = ko.newAtomicObservableManager();
        withinTransaction = true;
        try {
            fn();
            atomicObservableManager.commit();
        } finally {
            withinTransaction = false;
            ko.observableManager = ko.defaultObservableManager;
        }
    };
} ());

ko.exportSymbol('ko.atomically', ko.atomically);
