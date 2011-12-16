
ko.jsonExpressionRewriting = (function () {
	var restoreCapturedTokensRegex = /\[ko_token_(\d+)\]/g;
	var javaScriptAssignmentTarget = /^[\_$a-z][\_$a-z0-9]*(\[.*?\])*(\.[\_$a-z][\_$a-z0-9]*(\[.*?\])*)*$/i;
	var javaScriptReservedWords = ["true", "false"];

	function restoreTokens(string, tokens) {
		return string.replace(restoreCapturedTokensRegex, function (match, tokenIndex) {
			return tokens[tokenIndex];
		});
	}

	function isWriteableValue(expression) {
		if (ko.utils.arrayIndexOf(javaScriptReservedWords, ko.utils.stringTrim(expression).toLowerCase()) >= 0)
			return false;
		return expression.match(javaScriptAssignmentTarget) !== null;
	}

	return {
		parseJson: function (jsonString) {
			jsonString = ko.utils.stringTrim(jsonString);
			if (jsonString.length < 3)
				return {};

			// We're going to split on commas, so first extract any blocks that may contain commas other than those at the top level
			var tokens = [];
			var tokenStart = [], tokenEndChar = [], tokenIdx;
			var escaped = false, string = false;
			for (var position = jsonString.charAt(0) == "{" ? 1 : 0; position < jsonString.length; position++) {
				var c = jsonString.charAt(position);
				if (!escaped && tokenEndChar.length && (!string || c === '"' || c === "'") && (tokenIdx = tokenEndChar.lastIndexOf(c)) >= 0) {
					if (tokenIdx === 0) {
						var token = jsonString.substring(tokenStart[tokenIdx], position + 1);
						tokens.push(token);
						var replacement = "[ko_token_" + (tokens.length - 1) + "]";
						jsonString = jsonString.substring(0, tokenStart[tokenIdx]) + replacement + jsonString.substring(position + 1);
						position -= (token.length - replacement.length);
					}
					while (tokenStart.length > tokenIdx) {
						tokenStart.pop();
						tokenEndChar.pop();
					}
					string = false;
				} else if (escaped) {
					escaped = false;
				} else if (!string) switch (c) {
					case '"':
					case "'":
						string = true;
					case "/":
						tokenStart.push(position);
						tokenEndChar.push(c);
						break;
					case "(":
						tokenStart.push(position);
						tokenEndChar.push(")");
						break;
					case "{":
						tokenStart.push(position);
						tokenEndChar.push("}");
						break;
					case "[":
						tokenStart.push(position);
						tokenEndChar.push("]");
						break;
				} else switch (c) {
					case "\\":
						if (string) escaped = true;
						break;
				}
			}

			if (tokenStart.length) {
				throw new Error("Unclosed blocks: " + tokenEndChar.join(", "));
			}

			// Now we can safely split on commas to get the key/value pairs
			var result = {};
			var keyValuePairs = jsonString.split(",");
			for (var i = 0, j = keyValuePairs.length; i < j; i++) {
				var pair = keyValuePairs[i];
				var colonPos = pair.indexOf(":");
				if ((colonPos > 0) && (colonPos < pair.length - 1)) {
					var key = ko.utils.stringTrim(pair.substring(0, colonPos));
					var value = ko.utils.stringTrim(pair.substring(colonPos + 1));
					//                        if (key.charAt(0) == "{")
					//                            key = key.substring(1);
					//                        if (value.charAt(value.length - 1) == "}")
					//                            value = value.substring(0, value.length - 1);
					key = ko.utils.stringTrim(restoreTokens(key, tokens));
					value = ko.utils.stringTrim(restoreTokens(value, tokens));
					result[key] = value;
				}
			}
			return result;
		},

		insertPropertyAccessorsIntoJson: function (jsonString) {
			var parsed = ko.jsonExpressionRewriting.parseJson(jsonString);
			var propertyAccessorTokens = [];
			for (var key in parsed) {
				var value = parsed[key];
				if (isWriteableValue(value)) {
					if (propertyAccessorTokens.length > 0)
						propertyAccessorTokens.push(", ");
					propertyAccessorTokens.push(key + " : function(__ko_value) { " + value + " = __ko_value; }");
				}
			}

			if (propertyAccessorTokens.length > 0) {
				var allPropertyAccessors = propertyAccessorTokens.join("");
				jsonString = jsonString + ", '_ko_property_writers' : { " + allPropertyAccessors + " } ";
			}

			return jsonString;
		}
	};
})();

ko.exportSymbol('ko.jsonExpressionRewriting', ko.jsonExpressionRewriting);
ko.exportSymbol('ko.jsonExpressionRewriting.parseJson', ko.jsonExpressionRewriting.parseJson);
ko.exportSymbol('ko.jsonExpressionRewriting.insertPropertyAccessorsIntoJson', ko.jsonExpressionRewriting.insertPropertyAccessorsIntoJson);
