var primitiveTypes = { 'undefined':true, 'boolean':true, 'number':true, 'string':true };

function valuesArePrimitiveAndEqual(a, b) {
    var oldValueIsPrimitive = (a === null) || (typeof(a) in primitiveTypes);
    return oldValueIsPrimitive ? (a === b) : false;
}

ko.observable = function (initialValue) {
    var _latestValue = initialValue;
    
    function accessor() {
        if (arguments.length) {
            _latestValue = arguments[0];
        } else {
            return _latestValue;
        }
    }
    
    function observable() {
        var namedArgs = { observable: observable, accessor: accessor, allowWrite: allowWrite };
        if (arguments.length) {
            namedArgs.newValue = arguments[0];
        }
        return ko.observableManager.independentNodeAccessor.call(this, namedArgs);
    }
    ko.uid.dub(observable);
    observable.__ko_proto__ = ko.observable;
    observable.valueHasMutated = function () {
        var namedArgs = { observable: observable, accessor: accessor };
        ko.observableManager.compositeMutationBroadcast(namedArgs);
    };
    observable['equalityComparer'] = valuesArePrimitiveAndEqual;
    
    function allowWrite(args) {
        // Ignore writes if the value hasn't changed
        var equalityComparer = args.observable['equalityComparer'];
        return !equalityComparer || !equalityComparer(args.accessor(), args.newValue);
    }
    
    ko.subscribable.call(observable);
    
    ko.exportProperty(observable, "valueHasMutated", observable.valueHasMutated);
    
    return observable;
}
ko.isObservable = function (instance) {
    if ((instance === null) || (instance === undefined) || (instance.__ko_proto__ === undefined)) return false;
    if (instance.__ko_proto__ === ko.observable) return true;
    return ko.isObservable(instance.__ko_proto__); // Walk the prototype chain
}
ko.isWriteableObservable = function (instance) {
    // Observable
    if ((typeof instance == "function") && instance.__ko_proto__ === ko.observable)
        return true;
    // Writeable dependent observable
    if ((typeof instance == "function") && (instance.__ko_proto__ === ko.dependentObservable) && (instance.hasWriteFunction))
        return true;
    // Anything else
    return false;
}


ko.exportSymbol('ko.observable', ko.observable);
ko.exportSymbol('ko.isObservable', ko.isObservable);
ko.exportSymbol('ko.isWriteableObservable', ko.isWriteableObservable);
