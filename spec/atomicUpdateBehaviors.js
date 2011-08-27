describe("Atomic Updates", {

    "Should postpone publication until the end of a transaction": function () {
        var subject = ko.observable(), observer, firstCallback, subscription, endOfTransaction;

        // Dependent observable
        firstCallback = true;
        observer = ko.dependentObservable(function () {
            var newValue = subject();
            if (firstCallback) {
                firstCallback = false;
            } else {
                value_of(endOfTransaction).should_be_true();
            }
        });
        ko.atomically(function () {
            endOfTransaction = false;
            subject(0);
            subject(1);
            endOfTransaction = true;
        });
        observer.dispose();

        // Explicit subscription
        subscription = subject.subscribe(function (newValue) {
            value_of(endOfTransaction).should_be_true();
        });
        ko.atomically(function () {
            endOfTransaction = false;
            subject(0);
            subject(1);
            endOfTransaction = true;
        });
        subscription.dispose();
    },

    "Should only commit last-written values": function () {
        var
        subject = ko.observable(0),
        observer = ko.dependentObservable(function () {
            value_of(subject()).should_not_be(1);
        });

        value_of(subject()).should_be(0);
        ko.atomically(function () {
            subject(1);
            subject(2);
        });
        value_of(subject()).should_be(2);
    },

    "Should honor an equalityComparer and discard no-ops": function () {
        var
        subject = ko.observable(),
        observer = ko.dependentObservable(function () {
            evaluationCount++;
            var newValue = subject();
        }),
        evaluationCount;

        subject("a");
        evaluationCount = 0;
        value_of(subject()).should_be("a");
        value_of(evaluationCount).should_be(0);
        ko.atomically(function () {
            subject("b");
            subject("c");
            subject("a");
        });
        value_of(subject()).should_be("a");
        value_of(evaluationCount).should_be(0);

        // Control test
        subject("a");
        evaluationCount = 0;
        subject("b");
        subject("c");
        subject("a");
        value_of(subject()).should_be("a");
        value_of(evaluationCount).should_be(3);
    },

    "Should call back a dependentObservable's evaluation function at most once": function () {
        var subjects = [
            ko.observable(),
            ko.observable(),
            ko.observable()
        ],
        observer = ko.dependentObservable(function () {
            evaluationCount++;
            var a = subjects[0](), b = subjects[1](), c = subjects[2]();
            return a && b && c;
        }),
        evaluationCount;

        subjects[0](false);
        subjects[1](false);
        subjects[2](false);
        evaluationCount = 0;
        ko.atomically(function () {
            subjects[0](true);
            subjects[1](true);
            subjects[2](true);
        });
        value_of(evaluationCount).should_be(1);

        // Control test
        subjects[0](false);
        subjects[1](false);
        subjects[2](false);
        evaluationCount = 0;
        subjects[0](true);
        subjects[1](true);
        subjects[2](true);
        value_of(evaluationCount).should_be(3);
    },

    "Should evaluate transitive dependencies": function () {
        var a, b, c, evaluationCount = {};
        a = ko.observable("three");
        b = ko.dependentObservable(function () {
            evaluationCount.b++;
            return a().toUpperCase();
        });
        c = ko.dependentObservable(function () {
            evaluationCount.c++;
            return b().replace("O", "0").replace("E", "3");
        });

        evaluationCount = { b: 0, c: 0 };
        ko.atomically(function () {
            a("two");
            a("one");
        });
        value_of(a()).should_be("one");
        value_of(b()).should_be("ONE");
        value_of(c()).should_be("0N3");
        value_of(evaluationCount.b).should_be(1);
        value_of(evaluationCount.c).should_be(1);
    },

    "Should evaluate transitive dependencies at most once": function () {
        var a, A, b, B, c, evaluationCount = {};
        a = ko.observable("ZERO");
        A = ko.dependentObservable(function () {
            evaluationCount.A++;
            return a().toLowerCase();
        });
        b = ko.observable("ONE");
        B = ko.dependentObservable(function () {
            evaluationCount.B++;
            return b().toLowerCase();
        });
        c = ko.dependentObservable(function () {
            evaluationCount.c++;
            return A() + " " + B();
        });

        evaluationCount = { A: 0, B: 0, c: 0 };
        ko.atomically(function () {
            a("TWO");
            b("THREE");
        });
        value_of(A()).should_be("two");
        value_of(B()).should_be("three");
        value_of(c()).should_be("two three");
        value_of(evaluationCount.A).should_be(1);
        value_of(evaluationCount.B).should_be(1);
        value_of(evaluationCount.c).should_be(1);
    },

    "Should not interfere with dependency detection": function () {
        // The following unit test is a specific scenario where failure was observed.
        // Specifically, c2 had lost its subscription to b2 during the publication
        // phase of an atomic update.  Dependency detection was being bypassed.
        // (http://jsfiddle.net/QFjHb/5/)
        // (https://github.com/beickhoff/beickhoff.github.com/issues/1)
        var a, b1, b2, c1, c2, d, e, evaluationCount;

        a = ko.observable(0);
        b1 = ko.dependentObservable(function () {
            evaluationCount++;
            return a();
        });
        b2 = ko.dependentObservable(function () {
            evaluationCount++;
            return a();
        });
        c1 = ko.dependentObservable(function () {
            evaluationCount++;
            return b1();
        });
        c2 = ko.dependentObservable(function () {
            evaluationCount++;
            return b2();
        });
        d = ko.dependentObservable(function () {
            evaluationCount++;
            return c1() + c2();
        });
        e = ko.dependentObservable(function () {
            evaluationCount++;
            return a() + d();
        });

        evaluationCount = 0;
        ko.atomically(function () {
            a(2);
        });
        value_of(e()).should_be(6);
        value_of(evaluationCount).should_be(6);

        evaluationCount = 0;
        ko.atomically(function () {
            a(3);
        });
        value_of(e()).should_be(9);
        value_of(evaluationCount).should_be(6);
    },

    "Should work with observableArrays": function () {
        var a, b, c, evaluationCount;
        a = ko.observableArray([]);
        b = ko.observableArray([]);
        c = ko.dependentObservable(function () {
            evaluationCount++;
            return a().concat(b()).join("");
        });

        a([ 1, 2 ]);
        b([ 5, 6 ]);
        evaluationCount = 0;
        ko.atomically(function () {
            a([ 1, 2, 3 ]);
            a([ 1, 2, 3, 4 ]);
            b([ 5, 6, 7 ]);
            b([ 5, 6, 7, 8 ]);
        });
        value_of(c()).should_be("12345678");
        value_of(evaluationCount).should_be(1);

        // Control test
        a([ 1, 2 ]);
        b([ 5, 6 ]);
        evaluationCount = 0;
        a([ 1, 2, 3 ]);
        a([ 1, 2, 3, 4 ]);
        b([ 5, 6, 7 ]);
        b([ 5, 6, 7, 8 ]);
        value_of(c()).should_be("12345678");
        value_of(evaluationCount).should_be(4);
    },

    "Should work with autonomous subscriptions of observables": function () {
        var even, odd, listener, observedValues, invocationCount;
        even = ko.observable();
        odd = ko.observable();
        listener = function (newValue) {
            invocationCount++;
            observedValues.push(newValue);
        };
        even.subscribe(listener);
        odd.subscribe(listener);

        invocationCount = 0;
        observedValues = [];
        ko.atomically(function () {
            even(0);
            odd(1);
            odd(3);
            even(2);
        });
        value_of(invocationCount).should_be(2);
        value_of(observedValues.length).should_be(2);
        value_of(observedValues).should_include(2);
        value_of(observedValues).should_include(3);

        // Control test
        invocationCount = 0;
        observedValues = [];
        even(0);
        odd(1);
        odd(3);
        even(2);
        value_of(observedValues).should_be([ 0, 1, 3, 2 ]);
        value_of(invocationCount).should_be(4);
    },

    "Should work with autonomous subscriptions of dependentObservables": function () {
        var a, A, b, B, listener, observedValues, invocationCount;
        a = ko.observable();
        A = ko.dependentObservable(function () {
            return -a();
        });
        b = ko.observable();
        B = ko.dependentObservable(function () {
            return -b();
        });
        listener = function (newValue) {
            invocationCount++;
            observedValues.push(newValue);
        };
        A.subscribe(listener);
        B.subscribe(listener);

        invocationCount = 0;
        observedValues = [];
        ko.atomically(function () {
            a(0);
            b(-1);
            b(-3);
            a(-2);
        });
        value_of(A()).should_be(2);
        value_of(B()).should_be(3);
        value_of(invocationCount).should_be(2);
        value_of(observedValues.length).should_be(2);
        value_of(observedValues).should_include(2);
        value_of(observedValues).should_include(3);

        // Control test
        invocationCount = 0;
        observedValues = [];
        a(0);
        b(-1);
        b(-3);
        a(-2);
        value_of(observedValues).should_be([ 0, 1, 3, 2 ]);
        value_of(invocationCount).should_be(4);
    },

    "Should separate publish-phase mutations into separate transactions": function () {
        var a, A, b, B, C, evaluationCount = {}, values = [];
        a = ko.observable();
        b = ko.observable();
        A = ko.dependentObservable(function () {
            evaluationCount.A++;
            b(-a());
            return a() + 1;
        });
        B = ko.dependentObservable(function () {
            evaluationCount.B++;
            return b() - 1;
        });
        C = ko.dependentObservable(function () {
            evaluationCount.C++;
            var value = [ A(), B() ].join(", ");
            values.push(value);
            return value;
        });

        a(0);
        b(0);
        values = [];
        evaluationCount = { A: 0, B: 0, C: 0 };
        ko.atomically(function () {
            a(1);
        });
        value_of(A()).should_be(2);
        value_of(B()).should_be(-2);
        value_of(C()).should_be("2, -2");
        value_of(values).should_be([ "2, -1", "2, -2" ]);
        value_of(evaluationCount.A).should_be(1);
        value_of(evaluationCount.B).should_be(1);
        value_of(evaluationCount.C).should_be(2);

        // Control test
        a(0);
        b(0);
        values = [];
        evaluationCount = { A: 0, B: 0, C: 0 };
        a(1);
        value_of(A()).should_be(2);
        value_of(B()).should_be(-2);
        value_of(C()).should_be("2, -2");
        value_of(values).should_be([ "1, -2", "2, -2" ]);
        value_of(evaluationCount.A).should_be(1);
        value_of(evaluationCount.B).should_be(1);
        value_of(evaluationCount.C).should_be(2);
    },
    
    "Should not throw an exception if a dependentObservable is constructed during the mutation phase": function () {
      ko.atomically(function () {
        ko.dependentObservable(function () {});
      });
    },

    "Should allow reentrant invocations of atomically()": function () {
        var a, b, A, B, evaluationCount = {}, values = [];
        a = ko.observable();
        A = ko.dependentObservable(function () {
            evaluationCount.A++;
            values.push(a())
        });
        b = ko.observable();
        B = ko.dependentObservable(function () {
            evaluationCount.B++;
            return b();
        });

        a(3);
        b(11);
        values = [];
        evaluationCount = { A: 0, B: 0 };
        ko.atomically(function () {
            a(2);
            ko.atomically(function () {
                a(1);
                b(10);
            });
            a(0);
        });
        value_of(a()).should_be(0);
        value_of(evaluationCount.A).should_be(1);
        value_of(values).should_be([ 0 ]);
        value_of(b()).should_be(10);
        value_of(evaluationCount.B).should_be(1);

        // Control test
        a(3);
        b(11);
        values = [];
        evaluationCount = { A: 0, B: 0 };
        ko.atomically(function () {
            a(2);
            a(1);
            b(10);
            a(0);
        });
        value_of(a()).should_be(0);
        value_of(evaluationCount.A).should_be(1);
        value_of(values).should_be([ 0 ]);
        value_of(b()).should_be(10);
        value_of(evaluationCount.B).should_be(1);
    }

});
