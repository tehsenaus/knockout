
(function () {
	var defaultBindingAttributeName = "data-bind";
	ko.bindingHandlers = {};

	var memoisedBindingsJson = {};
	var memoisedBindings = {};

	function unwrapBindingName(binding) {
		if (binding[0] === "'" || binding[0] === '"')
			binding = binding.substring(1, binding.length - 1);
		return binding;
	}
	function parseBinding(binding) {
		var parsedBindings = {};
		for (var n in binding) {
			parsedBindings[unwrapBindingName(n)] = new Function("sc", "with(sc) { return (" + binding[n] + ") }");
		}
		return parsedBindings;
	}

	if (window.amplify) {
		var mj = amplify.store("ko.memoisedBindingsJson");
		if (mj) {
			for (var k in mj) {
				memoisedBindings[k] = parseBinding(mj[k]);
			}
		}
		function storeMemoisedBindings() {
			amplify.store("ko.memoisedBindingsJson", memoisedBindingsJson);
		}
		setTimeout(storeMemoisedBindings, 5000);
		window.onunload = storeMemoisedBindings;
	}

	function parseBindingAttribute(attributeText) {
		var parsedBindings = memoisedBindings[attributeText];
		if (parsedBindings === undefined) try {
			var json, parsed;

			Profiler.profiled(function () {
				json = ko.jsonExpressionRewriting.insertPropertyAccessorsIntoJson(attributeText);
				parsed = memoisedBindingsJson[attributeText] = ko.jsonExpressionRewriting.parseJson(json);
			}, "ko.parseBindingAttribute.parseJson")();

			parsedBindings = memoisedBindings[attributeText] = parseBinding(parsed);
		} catch (ex) {
			LOG.error("ko.parseBindingAttribute", JSON.stringify(ex), attributeText, parsed);
			throw new Error("Unable to parse binding attribute.\nMessage: " + ex + ";\nAttribute value: " + attributeText);
		}
		return parsedBindings;
	};
	parseBindingAttribute = Profiler.profiled(parseBindingAttribute, "ko.parseBindingAttribute");

	function invokeBindingHandler(handler, element, dataValue, allBindings, viewModel) {
		handler(element, dataValue, allBindings, viewModel);
	}


	// For browsers supporting getters / setters, optimise all bindings accessor
	var createParsedBindingsAccessor;
	if (window.Browser && ((Browser.ie && Browser.version > 8) || (Browser.chrome))) {
		var defineProperty;
		if (Object.defineProperty) {
			defineProperty = function (object, name, getter) {
				Object.defineProperty(object, name, { get: getter });
			}
		} else {
			defineProperty = function (object, name, getter) {
				object.__defineGetter__(name, getter);
			}
		}

		createParsedBindingsAccessor = Profiler.profiled(function (bindings) {
			var allBindings = {};
			for (var n in bindings) {
				defineProperty(allBindings, n, (function (fn) {
					return function () {
						return fn();
					}
				} (bindings[n])));
			}

			return Profiler.profiled(function () {
				return allBindings;
			}, "ko.allBindingsAccessor.optimised");
		}, "ko.createParsedBindingsAccessor.optimised");
	} else {
		createParsedBindingsAccessor = function (parsedBindings, viewModel) {
			return Profiler.profiled(function () {
				var bindings = {};
				for (var n in parsedBindings) {
					bindings[n] = parsedBindings[n]();
				}
				return bindings;
			}, "ko.allBindingsAccessor")
		}
	}

	ko.applyBindingsToNode = function (node, bindings, viewModel, bindingAttributeName) {
		bindingAttributeName = bindingAttributeName || defaultBindingAttributeName;

		// Each time the dependentObservable is evaluated (after data changes),
		// the binding attribute is reparsed so that it can pick out the correct
		// model properties in the context of the changed data.
		// DOM event callbacks need to be able to access this changed data,
		// so we need a single parsedBindings variable (shared by all callbacks
		// associated with this node's bindings) that all the closures can access.
		var allBindings = {};
		function makeValueAccessor(bindingKey) {
			return function () {
				return allBindings[bindingKey]();
			}
		}

		var evaluatedBindings = (typeof bindings == "function") ? bindings() : bindings;
		var parsedBindings = evaluatedBindings || parseBindingAttribute(node.getAttribute(bindingAttributeName));


		// Bind to View Model
		var bindingViewModel = viewModel === null ? window : viewModel;
		for (var n in parsedBindings) {
			allBindings[n] = ko.dependentObservable((function (fn, name) {
				return function () {
					try {
						return fn(bindingViewModel);
					} catch (ex) {
						throw new Error("Failed to evaluate binding: " + name + "\nIn: " + node.getAttribute(bindingAttributeName) + "\nError was: " + ex);
					}
				}
			} (parsedBindings[n], n)), null, { 'disposeWhenNodeIsRemoved': node });
		};

		// Not all bindings use this, so defer its construction until the first call.
		var parsedBindingsAccessorImpl = null;
		function parsedBindingsAccessor() {
			if (parsedBindingsAccessorImpl === null)
				parsedBindingsAccessorImpl = createParsedBindingsAccessor(allBindings);
			return parsedBindingsAccessorImpl();
		}

		for (var bindingKey in parsedBindings) {
			// Initialize the binding
			(Profiler.profiled(function (bindingHandler, bindingKey) {
				var valueAccessor = makeValueAccessor(bindingKey);

				if (bindingHandler && typeof bindingHandler["init"] == "function") try {
					Profiler.manager.enter("ko.initReal." + bindingKey);
					invokeBindingHandler(bindingHandler["init"], node, valueAccessor, parsedBindingsAccessor, viewModel);
				} finally {
					Profiler.manager.exit();
				}

				if (bindingHandler && typeof bindingHandler["update"] == "function") {
					new ko.dependentObservable(Profiler.profiled(function () {
						// ... then run all the updates, which might trigger changes even on the first evaluation
						try {
							invokeBindingHandler(bindingHandler["update"], node, valueAccessor, parsedBindingsAccessor, viewModel);
						} catch (ex) {
							LOG.error("Binding update failed", bindingKey, node.getAttribute(bindingAttributeName), ex, ex.stack);
							throw new Error("Binding update failed: " + bindingKey + "\nIn: " + node.getAttribute(bindingAttributeName) + "\n" + ex);
						}
					}, "ko.update." + bindingKey), null, { 'disposeWhenNodeIsRemoved': node });
				}
			}, "ko.init." + bindingKey))(ko.bindingHandlers[bindingKey], bindingKey);
		}
	};

    ko.applyBindings = function (viewModel, rootNode) {
        if (rootNode && (rootNode.nodeType == undefined))
            throw new Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node (note: this is a breaking change since KO version 1.05)");
        rootNode = rootNode || window.document.body; // Make "rootNode" parameter optional
                
        var elemsWithBindingAttribute = ko.utils.getElementsHavingAttribute(rootNode, defaultBindingAttributeName);
        ko.utils.arrayForEach(elemsWithBindingAttribute, function (element) {
            ko.applyBindingsToNode(element, null, viewModel);
        });
    };
    
    ko.exportSymbol('ko.bindingHandlers', ko.bindingHandlers);
    ko.exportSymbol('ko.applyBindings', ko.applyBindings);
    ko.exportSymbol('ko.applyBindingsToNode', ko.applyBindingsToNode);
})();