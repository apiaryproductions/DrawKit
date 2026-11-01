/**
 * DrawKit flow plugin.
 *
 * Turns any draw.io diagram into a runnable automation:
 * - Any shape can hold an action (stored as cell attributes, so the look
 *   of the shape does not matter).
 * - Connectors define the order. Connectors leaving an "If" step that are
 *   labelled yes/true or no/false/else pick the branch.
 * - Cycles are allowed (loops), guarded by a step limit.
 *
 * Native features (Shortcuts, notifications, HTTP) are requested from the
 * host page via window.parent.DrawKitHost.native(name, params), which
 * returns a Promise.
 */
(function()
{
	var ACTION_ATTR = 'drawkitAction';
	var PARAMS_ATTR = 'drawkitParams';
	var MAX_STEPS = 10000;
	var TRUE_WORDS = ['yes', 'true', 'then', 'y', '1', 'ok'];
	var FALSE_WORDS = ['no', 'false', 'else', 'otherwise', 'n', '0'];

	function host()
	{
		try
		{
			if (window.parent != window && window.parent.DrawKitHost != null)
			{
				return window.parent.DrawKitHost;
			}
		}
		catch (e)
		{
			// cross-origin parent
		}

		return null;
	}

	function native(name, params)
	{
		var h = host();

		if (h == null || h.native == null)
		{
			return Promise.reject(new Error('Native feature "' + name + '" is only available in the app'));
		}

		return Promise.resolve(h.native(name, params || {}));
	}

	function toText(value)
	{
		if (value == null)
		{
			return '';
		}
		else if (typeof value === 'object')
		{
			try
			{
				return JSON.stringify(value);
			}
			catch (e)
			{
				return String(value);
			}
		}

		return String(value);
	}

	// Replaces {{input}} and {{variableName}} (dots allowed for nested JSON values)
	function interpolate(text, ctx)
	{
		return String(text == null ? '' : text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, function(match, path)
		{
			var parts = path.split('.');
			var value = (parts[0] == 'input') ? ctx.input : ctx.vars[parts[0]];

			for (var i = 1; i < parts.length && value != null; i++)
			{
				if (typeof value === 'string')
				{
					try
					{
						value = JSON.parse(value);
					}
					catch (e)
					{
						return '';
					}
				}

				value = value[parts[i]];
			}

			return toText(value);
		});
	}

	function sleep(ms, ctx)
	{
		return new Promise(function(resolve, reject)
		{
			var timer = window.setTimeout(resolve, ms);
			ctx.onStop(function()
			{
				window.clearTimeout(timer);
				reject(new Error('Stopped'));
			});
		});
	}

	/**
	 * Action registry. Each param: {name, label, type: text|multiline|select|number,
	 * options, value (default)}. run(ctx, params) returns the step output (may
	 * be a Promise). ctx.input is the previous step's output.
	 */
	var Actions = {};
	var actionOrder = [];

	function registerAction(id, def)
	{
		if (Actions[id] == null)
		{
			actionOrder.push(id);
		}

		def.id = id;
		Actions[id] = def;
	}

	registerAction('start', {title: 'Start', group: 'Flow',
		help: 'Where the flow begins. Optional: without it, every action with no incoming connector is a start.',
		params: [{name: 'input', label: 'Initial input (optional)', type: 'multiline'}],
		run: function(ctx, p) { return p.input; }});
	registerAction('if', {title: 'If', group: 'Flow',
		help: 'Label the outgoing connectors "yes" and "no". Unlabelled connectors always run.',
		params: [{name: 'left', label: 'Value', value: '{{input}}'},
			{name: 'op', label: 'Condition', type: 'select', value: 'equals', options: ['equals', 'does not equal',
				'contains', 'does not contain', 'is greater than', 'is less than', 'is empty', 'is not empty']},
			{name: 'right', label: 'Compare to'}],
		run: function(ctx, p)
		{
			var a = p.left, b = p.right, na = parseFloat(a), nb = parseFloat(b);
			var result = {'equals': a == b, 'does not equal': a != b,
				'contains': a.indexOf(b) >= 0, 'does not contain': a.indexOf(b) < 0,
				'is greater than': na > nb, 'is less than': na < nb,
				'is empty': a.trim() == '', 'is not empty': a.trim() != ''}[p.op];
			ctx.branch = !!result;
			ctx.log('Condition is ' + (result ? 'true' : 'false'));

			return ctx.input;
		}});
	registerAction('wait', {title: 'Wait', group: 'Flow',
		params: [{name: 'seconds', label: 'Seconds', type: 'number', value: '1'}],
		run: function(ctx, p)
		{
			return sleep(Math.max(0, parseFloat(p.seconds) || 0) * 1000, ctx).then(function()
			{
				return ctx.input;
			});
		}});
	registerAction('stop', {title: 'Stop Flow', group: 'Flow', params: [],
		run: function(ctx) { ctx.stopRequested = true; return ctx.input; }});
	registerAction('text', {title: 'Text', group: 'Data',
		params: [{name: 'text', label: 'Text', type: 'multiline'}],
		run: function(ctx, p) { return p.text; }});
	registerAction('setVariable', {title: 'Set Variable', group: 'Data',
		params: [{name: 'name', label: 'Variable name', raw: true}, {name: 'value', label: 'Value', value: '{{input}}'}],
		run: function(ctx, p) { ctx.vars[p.name] = p.value; return ctx.input; }});
	registerAction('getVariable', {title: 'Get Variable', group: 'Data',
		params: [{name: 'name', label: 'Variable name', raw: true}],
		run: function(ctx, p) { return ctx.vars[p.name]; }});
	registerAction('math', {title: 'Calculate', group: 'Data',
		help: 'Numbers and + - * / % ( ) only, for example {{count}} + 1',
		params: [{name: 'expression', label: 'Expression', value: '{{input}} + 1'}],
		run: function(ctx, p)
		{
			if (!/^[\d\s+\-*/%().eE]*$/.test(p.expression))
			{
				throw new Error('Calculate only accepts numbers and + - * / % ( ): ' + p.expression);
			}

			return String(Function('"use strict"; return (' + (p.expression || '0') + ');')());
		}});
	registerAction('javascript', {title: 'Run JavaScript', group: 'Data',
		help: 'Available: input, vars, log(text), native(name, params). Return the output (await works).',
		params: [{name: 'code', label: 'Code', type: 'multiline', raw: true, value: 'return input;'}],
		run: function(ctx, p)
		{
			var AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
			var fn = new AsyncFunction('input', 'vars', 'log', 'native', p.code);

			return fn(ctx.input, ctx.vars, ctx.log, native);
		}});
	registerAction('ask', {title: 'Ask for Input', group: 'Interaction',
		params: [{name: 'prompt', label: 'Question', value: 'Enter a value'}, {name: 'default', label: 'Default answer'}],
		run: function(ctx, p)
		{
			var answer = window.prompt(p.prompt, p['default']);

			if (answer == null)
			{
				throw new Error('Cancelled');
			}

			return answer;
		}});
	registerAction('show', {title: 'Show Result', group: 'Interaction',
		params: [{name: 'text', label: 'Text', type: 'multiline', value: '{{input}}'}],
		run: function(ctx, p) { window.alert(p.text); return ctx.input; }});
	registerAction('notify', {title: 'Show Notification', group: 'Interaction',
		params: [{name: 'title', label: 'Title', value: 'DrawKit'}, {name: 'body', label: 'Message', value: '{{input}}'}],
		run: function(ctx, p) { return native('notify', p).then(function() { return ctx.input; }); }});
	registerAction('copy', {title: 'Copy to Clipboard', group: 'Interaction',
		params: [{name: 'text', label: 'Text', value: '{{input}}'}],
		run: function(ctx, p) { return native('copy', p).then(function() { return ctx.input; }); }});
	registerAction('paste', {title: 'Get Clipboard', group: 'Interaction', params: [],
		run: function(ctx) { return native('paste', {}); }});
	registerAction('runShortcut', {title: 'Run Shortcut', group: 'Apple',
		help: 'Runs a shortcut from the Shortcuts app by its exact name. On iPad, DrawKit cannot receive the ' +
			'shortcut\'s output directly: end the shortcut with "Copy to Clipboard" and "Open App: Swift Playgrounds" ' +
			'(or DrawKit), and choose "Wait for clipboard" below.',
		params: [{name: 'name', label: 'Shortcut name'}, {name: 'input', label: 'Input', value: '{{input}}'},
			{name: 'result', label: 'Output', type: 'select', value: 'Wait for clipboard',
				options: ['Wait for clipboard', 'Do not wait']}],
		run: function(ctx, p) { return native('runShortcut', p); }});
	registerAction('openURL', {title: 'Open URL', group: 'Apple',
		params: [{name: 'url', label: 'URL', value: 'https://'}],
		run: function(ctx, p) { return native('openURL', p).then(function() { return ctx.input; }); }});
	registerAction('http', {title: 'Web Request', group: 'Web',
		params: [{name: 'url', label: 'URL', value: 'https://'},
			{name: 'method', label: 'Method', type: 'select', value: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']},
			{name: 'headers', label: 'Headers (JSON)', value: '{}'},
			{name: 'body', label: 'Body', type: 'multiline'}],
		run: function(ctx, p) { return native('http', p); }});

	/**
	 * Reads the flow graph from the current page.
	 */
	function readFlow(graph)
	{
		var model = graph.getModel();
		var nodes = {};
		var edges = [];

		for (var id in model.cells)
		{
			var cell = model.cells[id];

			if (model.isVertex(cell))
			{
				nodes[cell.id] = {cell: cell, action: getAction(graph, cell), incoming: 0, outgoing: []};
			}
			else if (model.isEdge(cell))
			{
				edges.push(cell);
			}
		}

		for (var i = 0; i < edges.length; i++)
		{
			var source = model.getTerminal(edges[i], true);
			var target = model.getTerminal(edges[i], false);

			if (source != null && target != null && nodes[source.id] != null && nodes[target.id] != null)
			{
				nodes[source.id].outgoing.push({edge: edges[i], target: nodes[target.id],
					label: String(graph.convertValueToString(edges[i]) || '').trim().toLowerCase()});
				nodes[target.id].incoming++;
			}
		}

		for (var key in nodes)
		{
			nodes[key].outgoing.sort(function(a, b) { return comparePosition(graph, a.target.cell, b.target.cell); });
		}

		var starts = [];

		for (var key in nodes)
		{
			if (nodes[key].action != null && nodes[key].action.id == 'start')
			{
				starts.push(nodes[key]);
			}
		}

		if (starts.length == 0)
		{
			for (var key in nodes)
			{
				if (nodes[key].action != null && nodes[key].incoming == 0)
				{
					starts.push(nodes[key]);
				}
			}
		}

		starts.sort(function(a, b) { return comparePosition(graph, a.cell, b.cell); });

		return {nodes: nodes, starts: starts};
	}

	function comparePosition(graph, a, b)
	{
		var sa = graph.view.getState(a), sb = graph.view.getState(b);
		var ga = (sa != null) ? sa : graph.getCellGeometry(a) || {x: 0, y: 0};
		var gb = (sb != null) ? sb : graph.getCellGeometry(b) || {x: 0, y: 0};

		return (Math.abs(ga.y - gb.y) > 10) ? ga.y - gb.y : ga.x - gb.x;
	}

	function getAction(graph, cell)
	{
		var id = (cell.value != null && typeof cell.value === 'object') ? cell.value.getAttribute(ACTION_ATTR) : null;

		if (id == null || id == '')
		{
			return null;
		}

		var params = {};

		try
		{
			params = JSON.parse(cell.value.getAttribute(PARAMS_ATTR) || '{}') || {};
		}
		catch (e)
		{
			// keeps empty params
		}

		return {id: id, def: Actions[id], params: params};
	}

	function resolveParams(def, params, ctx)
	{
		var result = {};

		for (var i = 0; i < def.params.length; i++)
		{
			var p = def.params[i];
			var value = (params[p.name] != null) ? params[p.name] : (p.value || '');
			result[p.name] = (p.raw || p.type == 'select') ? value : interpolate(value, ctx);
		}

		return result;
	}

	/**
	 * Runs the flow on the current page. Steps run one at a time: when a step
	 * has several outgoing connectors, each branch runs to its end before the
	 * next one starts (top-to-bottom, then left-to-right).
	 */
	function Runner(ui, listener)
	{
		this.ui = ui;
		this.listener = listener || function() {};
		this.stopHandlers = [];
		this.running = false;
	}

	Runner.prototype.stop = function()
	{
		if (this.running)
		{
			this.stopped = true;
			var handlers = this.stopHandlers;
			this.stopHandlers = [];

			for (var i = 0; i < handlers.length; i++)
			{
				handlers[i]();
			}
		}
	};

	Runner.prototype.run = async function(initialInput)
	{
		if (this.running)
		{
			throw new Error('Already running');
		}

		var graph = this.ui.editor.graph;
		var flow = readFlow(graph);
		var self = this;
		var vars = {};
		var steps = 0;
		var output = initialInput;
		this.running = true;
		this.stopped = false;

		var emit = function(type, data)
		{
			try
			{
				self.listener(type, data || {});
			}
			catch (e)
			{
				// ignore listener errors
			}
		};

		emit('start', {count: flow.starts.length});

		try
		{
			if (flow.starts.length == 0)
			{
				throw new Error('Nothing to run. Select a shape and use "Action…" to give it an action.');
			}

			var stack = [];

			for (var i = flow.starts.length - 1; i >= 0; i--)
			{
				stack.push({node: flow.starts[i], input: initialInput});
			}

			while (stack.length > 0 && !this.stopped)
			{
				var item = stack.pop();
				var node = item.node;

				if (++steps > MAX_STEPS)
				{
					throw new Error('Stopped after ' + MAX_STEPS + ' steps (endless loop?)');
				}

				var ctx = {input: item.input, vars: vars, branch: null, stopRequested: false,
					log: function(text) { emit('log', {text: toText(text)}); },
					onStop: function(fn) { self.stopHandlers.push(fn); }};
				var result = item.input;

				if (node.action != null)
				{
					var def = node.action.def;

					if (def == null)
					{
						throw new Error('Unknown action "' + node.action.id + '"');
					}

					emit('step', {cell: node.cell, title: def.title});
					result = await def.run(ctx, resolveParams(def, node.action.params, ctx));
					self.stopHandlers = [];

					if (result === undefined)
					{
						result = null;
					}

					emit('result', {cell: node.cell, title: def.title, value: toText(result)});
				}

				output = result;

				if (ctx.stopRequested)
				{
					break;
				}

				var next = node.outgoing;

				if (ctx.branch != null)
				{
					next = next.filter(function(link)
					{
						if (TRUE_WORDS.indexOf(link.label) >= 0)
						{
							return ctx.branch;
						}
						else if (FALSE_WORDS.indexOf(link.label) >= 0)
						{
							return !ctx.branch;
						}

						return true;
					});
				}

				for (var i = next.length - 1; i >= 0; i--)
				{
					stack.push({node: next[i].target, input: result});
				}
			}

			emit(this.stopped ? 'stopped' : 'done', {value: toText(output)});

			return output;
		}
		catch (e)
		{
			emit(this.stopped ? 'stopped' : 'error', {message: (e != null && e.message) ? e.message : String(e)});

			if (!this.stopped)
			{
				throw e;
			}
		}
		finally
		{
			this.running = false;
			this.stopHandlers = [];
		}
	};

	/**
	 * Editor integration
	 */
	function install(ui)
	{
		var graph = ui.editor.graph;
		var highlight = new mxCellHighlight(graph, '#34C759', 4);
		var logLines = [];

		var panel = document.createElement('div');
		panel.className = 'drawkitPanel';
		panel.innerHTML = '<div class="drawkitBar">' +
			'<button data-cmd="run" class="drawkitRun">&#9654; Run</button>' +
			'<button data-cmd="stop" disabled>&#9632; Stop</button>' +
			'<button data-cmd="action">Action&hellip;</button>' +
			'<button data-cmd="log">Log</button></div>' +
			'<div class="drawkitLog" style="display:none"></div>';
		document.body.appendChild(panel);

		var style = document.createElement('style');
		style.textContent = '.drawkitPanel{position:fixed;left:50%;transform:translateX(-50%);bottom:44px;z-index:5;display:flex;' +
			'flex-direction:column-reverse;align-items:center;font:13px -apple-system,system-ui,sans-serif;' +
			'max-width:calc(100vw - 24px)}' +
			'.drawkitBar{display:flex;gap:6px;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.12);border-radius:8px}' +
			'.drawkitBar button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #c7c7cc;' +
			'background:#fff;color:#111;cursor:pointer;min-height:36px}' +
			'.drawkitBar button:disabled{opacity:.4}' +
			'.drawkitBar .drawkitRun{background:#34C759;border-color:#34C759;color:#fff;font-weight:600}' +
			'.drawkitLog{margin-bottom:6px;width:340px;max-width:100%;max-height:40vh;overflow:auto;background:#fff;' +
			'color:#111;border:1px solid #c7c7cc;border-radius:8px;padding:8px;white-space:pre-wrap;' +
			'font:12px ui-monospace,Menlo,monospace;box-shadow:0 4px 16px rgba(0,0,0,.12)}' +
			'.drawkitLog .err{color:#d70015}.drawkitLog .ok{color:#248a3d}' +
			'.drawkitDialog{font:13px -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;' +
			'gap:8px;height:100%;box-sizing:border-box}' +
			'.drawkitDialog label{font-weight:600;display:block;margin-bottom:2px}' +
			'.drawkitDialog input,.drawkitDialog select,.drawkitDialog textarea{width:100%;box-sizing:border-box;' +
			'font:inherit;padding:6px;border:1px solid #c7c7cc;border-radius:6px;background:inherit;color:inherit}' +
			'.drawkitDialog textarea{min-height:80px;font-family:ui-monospace,Menlo,monospace}' +
			'.drawkitDialog .help{color:#6e6e73;font-size:12px}' +
			'.drawkitFields{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px}' +
			'.drawkitButtons{display:flex;gap:8px;justify-content:flex-end}' +
			'.drawkitButtons button{font:inherit;padding:6px 14px;border-radius:6px}' +
			'@media (prefers-color-scheme: dark){.drawkitBar button,.drawkitLog{background:#2c2c2e;color:#f2f2f7;' +
			'border-color:#48484a}}';
		document.head.appendChild(style);

		var log = panel.querySelector('.drawkitLog');
		var runButton = panel.querySelector('[data-cmd=run]');
		var stopButton = panel.querySelector('[data-cmd=stop]');

		function addLog(text, cls)
		{
			var line = document.createElement('div');
			line.textContent = text;

			if (cls != null)
			{
				line.className = cls;
			}

			log.appendChild(line);
			log.scrollTop = log.scrollHeight;
			logLines.push(text);
		}

		var runner = new Runner(ui, function(type, data)
		{
			if (type == 'start')
			{
				log.innerHTML = '';
				logLines = [];
				log.style.display = '';
				addLog('Running…');
			}
			else if (type == 'step')
			{
				highlight.highlight(graph.view.getState(data.cell));
				graph.scrollCellToVisible(data.cell);
			}
			else if (type == 'result')
			{
				var value = data.value.length > 200 ? data.value.substring(0, 200) + '…' : data.value;
				addLog('✓ ' + data.title + (value != '' ? ': ' + value : ''));
			}
			else if (type == 'log')
			{
				addLog('  ' + data.text);
			}
			else if (type == 'done')
			{
				addLog('Finished', 'ok');
			}
			else if (type == 'stopped')
			{
				addLog('Stopped', 'err');
			}
			else if (type == 'error')
			{
				addLog('Error: ' + data.message, 'err');
			}

			if (type == 'done' || type == 'stopped' || type == 'error')
			{
				highlight.hide();
				runButton.disabled = false;
				stopButton.disabled = true;
			}

			var h = host();

			if (h != null && h.onFlowEvent != null)
			{
				h.onFlowEvent(type, {title: data.title, value: data.value, message: data.message});
			}
		});

		function run(input)
		{
			runButton.disabled = true;
			stopButton.disabled = false;

			return runner.run(input);
		}

		function editAction(cells)
		{
			cells = (cells || graph.getSelectionCells()).filter(function(c) { return graph.getModel().isVertex(c); });

			if (cells.length == 0)
			{
				ui.showError('Action', 'Select one or more shapes first.', mxResources.get('ok'));
				return;
			}

			var current = getAction(graph, cells[0]);
			var div = document.createElement('div');
			div.className = 'drawkitDialog';

			var typeLabel = document.createElement('label');
			typeLabel.textContent = 'Action';
			var select = document.createElement('select');
			var none = document.createElement('option');
			none.value = '';
			none.textContent = '(none)';
			select.appendChild(none);
			var groups = {};

			for (var i = 0; i < actionOrder.length; i++)
			{
				var def = Actions[actionOrder[i]];

				if (groups[def.group] == null)
				{
					groups[def.group] = document.createElement('optgroup');
					groups[def.group].label = def.group || 'Other';
					select.appendChild(groups[def.group]);
				}

				var opt = document.createElement('option');
				opt.value = def.id;
				opt.textContent = def.title;
				groups[def.group].appendChild(opt);
			}

			select.value = (current != null) ? current.id : '';
			typeLabel.appendChild(select);
			div.appendChild(typeLabel);

			var fields = document.createElement('div');
			fields.className = 'drawkitFields';
			div.appendChild(fields);
			var inputs = {};

			function renderFields()
			{
				fields.innerHTML = '';
				inputs = {};
				var def = Actions[select.value];

				if (def == null)
				{
					return;
				}

				var params = (current != null && current.id == def.id) ? current.params : {};

				if (def.help != null)
				{
					var help = document.createElement('div');
					help.className = 'help';
					help.textContent = def.help;
					fields.appendChild(help);
				}

				for (var i = 0; i < def.params.length; i++)
				{
					var p = def.params[i];
					var label = document.createElement('label');
					label.textContent = p.label;
					var input;

					if (p.type == 'select')
					{
						input = document.createElement('select');

						for (var j = 0; j < p.options.length; j++)
						{
							var o = document.createElement('option');
							o.value = p.options[j];
							o.textContent = p.options[j];
							input.appendChild(o);
						}
					}
					else if (p.type == 'multiline')
					{
						input = document.createElement('textarea');
					}
					else
					{
						input = document.createElement('input');
						input.type = 'text';
						input.setAttribute('autocapitalize', 'off');
						input.setAttribute('autocorrect', 'off');
					}

					input.value = (params[p.name] != null) ? params[p.name] : (p.value || '');
					label.appendChild(input);
					fields.appendChild(label);
					inputs[p.name] = input;
				}

				var tip = document.createElement('div');
				tip.className = 'help';
				tip.textContent = 'Use {{input}} for the previous step\'s output and {{name}} for a variable.';
				fields.appendChild(tip);
			}

			select.addEventListener('change', renderFields);
			renderFields();

			var buttons = document.createElement('div');
			buttons.className = 'drawkitButtons';
			var cancel = mxUtils.button(mxResources.get('cancel'), function() { ui.hideDialog(); });
			cancel.className = 'geBtn';
			var apply = mxUtils.button(mxResources.get('apply'), function()
			{
				var def = Actions[select.value];
				var params = {};

				for (var name in inputs)
				{
					params[name] = inputs[name].value;
				}

				setActions(cells, def, params);
				ui.hideDialog();
			});
			apply.className = 'geBtn gePrimaryBtn';
			buttons.appendChild(cancel);
			buttons.appendChild(apply);
			div.appendChild(buttons);

			ui.showDialog(div, 360, 440, true, true);
			select.focus();
		}

		function setActions(cells, def, params)
		{
			graph.getModel().beginUpdate();

			try
			{
				for (var i = 0; i < cells.length; i++)
				{
					var label = graph.convertValueToString(cells[i]);
					var oldAction = getAction(graph, cells[i]);
					var oldTitle = (oldAction != null && oldAction.def != null) ? oldAction.def.title : null;
					graph.setAttributeForCell(cells[i], ACTION_ATTR, def != null ? def.id : null);
					graph.setAttributeForCell(cells[i], PARAMS_ATTR, def != null ? JSON.stringify(params) : null);

					// Names empty shapes (or ones still named after the old action) after the action
					if (def != null && (label == null || label == '' || label == oldTitle))
					{
						graph.labelChanged(cells[i], def.title);
					}
				}
			}
			finally
			{
				graph.getModel().endUpdate();
			}
		}

		panel.addEventListener('click', function(evt)
		{
			var cmd = evt.target.getAttribute('data-cmd');

			if (cmd == 'run')
			{
				run().catch(function() { /* shown in log */ });
			}
			else if (cmd == 'stop')
			{
				runner.stop();
			}
			else if (cmd == 'action')
			{
				editAction();
			}
			else if (cmd == 'log')
			{
				log.style.display = (log.style.display == 'none') ? '' : 'none';
			}
		});

		// Context menu entry
		ui.actions.addAction('drawkitAction...', function() { editAction(); });
		mxResources.parse('drawkitAction=Action');
		var createPopupMenu = ui.menus.createPopupMenu;

		ui.menus.createPopupMenu = function(menu, cell, evt)
		{
			createPopupMenu.apply(this, arguments);

			if (graph.getSelectionCount() > 0 && graph.getModel().isVertex(graph.getSelectionCell()))
			{
				this.addMenuItems(menu, ['-', 'drawkitAction'], null, evt);
			}
		};

		// Double-click on a shape that has an action opens the action editor
		var dblClick = graph.dblClick;

		graph.dblClick = function(evt, cell)
		{
			if (cell != null && getAction(graph, cell) != null && !mxEvent.isAltDown(evt))
			{
				graph.setSelectionCell(cell);
				editAction([cell]);
			}
			else
			{
				dblClick.apply(this, arguments);
			}
		};

		// Tooltip shows the action
		var getTooltipForCell = graph.getTooltipForCell;

		graph.getTooltipForCell = function(cell)
		{
			var action = getAction(graph, cell);

			if (action != null && action.def != null)
			{
				var text = '<b>' + mxUtils.htmlEntities(action.def.title) + '</b>';

				for (var key in action.params)
				{
					if (action.params[key] != '')
					{
						text += '<br>' + mxUtils.htmlEntities(key) + ': ' +
							mxUtils.htmlEntities(String(action.params[key]).substring(0, 80));
					}
				}

				return text;
			}

			return getTooltipForCell.apply(this, arguments);
		};

		var puck = installPuck(ui);

		window.DrawKit = {run: run, stop: function() { runner.stop(); }, editAction: editAction,
			registerAction: registerAction, actions: Actions, readFlow: function() { return readFlow(graph); },
			setActions: setActions, getLog: function() { return logLines.slice(); }, puck: puck, ui: ui};

		var h = host();

		if (h != null && h.onPluginReady != null)
		{
			h.onPluginReady(window.DrawKit);
		}
	}

	/**
	 * Puck: a floating button for Apple Pencil users. The Pencil only draws
	 * (freehand ink) unless a finger is holding the puck, in which case the
	 * Pencil selects, moves and connects shapes like a mouse. Fingers keep
	 * working as usual. Drag the puck to move it; double-tap it to turn
	 * Pencil drawing off (the Pencil then always selects).
	 */
	function installPuck(ui)
	{
		var graph = ui.editor.graph;
		var freehand = graph.freehand;
		var held = {};
		var heldCount = 0;
		var penDraws = loadSetting('penDraws', true);
		var lastTap = 0;

		var puck = document.createElement('div');
		puck.className = 'drawkitPuck';
		puck.setAttribute('role', 'button');
		puck.setAttribute('aria-label', 'Hold to select with Apple Pencil');
		document.body.appendChild(puck);

		var style = document.createElement('style');
		style.textContent = '.drawkitPuck{position:fixed;width:64px;height:64px;border-radius:50%;z-index:6;' +
			'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;' +
			'display:flex;align-items:center;justify-content:center;font:600 11px -apple-system,system-ui,sans-serif;' +
			'text-align:center;line-height:1.1;background:rgba(255,255,255,.92);color:#111;' +
			'border:2px solid #c7c7cc;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .08s,background .08s}' +
			'.drawkitPuck.held{background:#0a84ff;border-color:#0a84ff;color:#fff;transform:scale(1.12)}' +
			'.drawkitPuck.off{opacity:.55}' +
			'@media (prefers-color-scheme: dark){.drawkitPuck{background:rgba(44,44,46,.92);color:#f2f2f7;' +
			'border-color:#48484a}}';
		document.head.appendChild(style);

		var pos = loadSetting('puckPos', null);

		function place(x, y)
		{
			x = Math.max(4, Math.min(window.innerWidth - 68, x));
			y = Math.max(4, Math.min(window.innerHeight - 68, y));
			puck.style.left = x + 'px';
			puck.style.top = y + 'px';
			pos = {x: x, y: y};
		}

		place(pos != null ? pos.x : 16, pos != null ? pos.y : window.innerHeight * 0.55);
		window.addEventListener('resize', function() { place(pos.x, pos.y); });

		function update()
		{
			puck.classList.toggle('held', heldCount > 0);
			puck.classList.toggle('off', !penDraws);
			puck.innerHTML = heldCount > 0 ? 'Select' : (penDraws ? 'Hold to<br>select' : 'Pencil<br>selects');
		}

		update();

		var drag = null;

		puck.addEventListener('pointerdown', function(evt)
		{
			evt.preventDefault();
			evt.stopPropagation();
			try
			{
				puck.setPointerCapture(evt.pointerId);
			}
			catch (e)
			{
				// Keeps working without capture
			}

			held[evt.pointerId] = true;
			heldCount++;
			drag = {id: evt.pointerId, x: evt.clientX, y: evt.clientY, left: pos.x, top: pos.y, moved: false};

			stopPuckDrawing();

			update();
		});

		puck.addEventListener('pointermove', function(evt)
		{
			if (drag != null && drag.id == evt.pointerId)
			{
				var dx = evt.clientX - drag.x, dy = evt.clientY - drag.y;

				if (drag.moved || Math.abs(dx) + Math.abs(dy) > 12)
				{
					drag.moved = true;
					place(drag.left + dx, drag.top + dy);
				}
			}
		});

		function release(evt)
		{
			if (held[evt.pointerId])
			{
				delete held[evt.pointerId];
				heldCount = Math.max(0, heldCount - 1);

				if (drag != null && drag.id == evt.pointerId)
				{
					if (drag.moved)
					{
						saveSetting('puckPos', pos);
					}
					else if (evt.type == 'pointerup')
					{
						var now = Date.now();

						if (now - lastTap < 350)
						{
							penDraws = !penDraws;
							saveSetting('penDraws', penDraws);
							lastTap = 0;
						}
						else
						{
							lastTap = now;
						}
					}

					drag = null;
				}

				update();
			}
		}

		puck.addEventListener('pointerup', release);
		puck.addEventListener('pointercancel', release);
		puck.addEventListener('lostpointercapture', release);
		puck.addEventListener('contextmenu', function(evt) { evt.preventDefault(); });

		// Only turns off freehand drawing that the puck turned on, and leaves
		// draw.io's own Freehand tool alone
		var puckStarted = false;

		function stopPuckDrawing()
		{
			if (puckStarted && freehand.isDrawing() && !freehand.isActive())
			{
				freehand.stopDrawing();
			}

			puckStarted = false;
		}

		// Decides what a touch on the canvas does before draw.io sees it
		function routePointer(evt)
		{
			if (freehand == null || (ui.freehandWindow != null && ui.freehandWindow.window.isVisible()))
			{
				return;
			}

			if (evt.pointerType == 'pen' && penDraws && heldCount == 0)
			{
				if (!freehand.isDrawing())
				{
					graph.clearSelection();
					freehand.setAutoInsert(true);
					freehand.setStopClickEnabled(false);
					freehand.setSelectInserted(false);
					freehand.startDrawing();
					puckStarted = true;
				}
			}
			else
			{
				stopPuckDrawing();
			}
		}

		graph.container.addEventListener('pointerdown', routePointer, true);

		return {
			isHeld: function() { return heldCount > 0; },
			setPenDraws: function(value) { penDraws = !!value; saveSetting('penDraws', penDraws); update(); },
			element: puck
		};
	}

	function loadSetting(key, defaultValue)
	{
		try
		{
			var value = window.localStorage.getItem('drawkit.' + key);

			return (value != null) ? JSON.parse(value) : defaultValue;
		}
		catch (e)
		{
			return defaultValue;
		}
	}

	function saveSetting(key, value)
	{
		try
		{
			window.localStorage.setItem('drawkit.' + key, JSON.stringify(value));
		}
		catch (e)
		{
			// Settings are optional
		}
	}

	// Draw is created when the app has loaded its plugin support
	(function waitForDraw()
	{
		if (window.Draw != null && window.Draw.loadPlugin != null)
		{
			window.Draw.loadPlugin(install);
		}
		else
		{
			window.setTimeout(waitForDraw, 50);
		}
	})();
})();
