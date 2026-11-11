/**
 * DrawKit input plugin: Apple Pencil, the puck, the radial menu and
 * customisable gestures.
 *
 * - Every Pencil gesture on the canvas is routed by the bindings in
 *   settings (Gestures in the menu): which drag or tap action runs depends
 *   on whether the puck or one or two fingers are held down.
 * - The puck is a floating button: hold it while using the Pencil, or
 *   double-tap it for the menu. It also shows the current mode.
 * - The menu is a ring of favourites with a grid of every command behind
 *   the centre button (or the grid only).
 * - The app calls DrawKitInput.pencil('doubleTap' | 'squeeze', x, y) for
 *   Apple Pencil double-tap and squeeze.
 */
(function()
{
	var DRAG_OPTIONS = [
		['none', 'Nothing'],
		['moveOrPan', 'Move selection, otherwise pan'],
		['pan', 'Pan'],
		['zoom', 'Zoom (drag up and down)'],
		['selectBox', 'Selection box'],
		['draw', 'Draw'],
		['connect', 'Connect shapes']
	];

	var INPUTS = [
		{id: 'penDrag', title: 'Pencil drag', kind: 'drag'},
		{id: 'penTap', title: 'Pencil tap', kind: 'tap'},
		{id: 'puckDrag', title: 'Puck + Pencil drag', kind: 'drag'},
		{id: 'puckTap', title: 'Puck + Pencil tap', kind: 'tap'},
		{id: 'finger1Drag', title: '1 finger + Pencil drag', kind: 'drag'},
		{id: 'finger2Drag', title: '2 fingers + Pencil drag', kind: 'drag'},
		{id: 'doubleTap', title: 'Pencil double-tap', kind: 'tap'},
		{id: 'squeeze', title: 'Pencil squeeze (Pencil Pro)', kind: 'tap'},
		{id: 'puckDoubleTap', title: 'Puck double-tap', kind: 'tap'}
	];

	var DEFAULTS = {
		bindings: {penDrag: 'moveOrPan', penTap: 'none', puckDrag: 'selectBox', puckTap: 'rightClick',
			finger1Drag: 'zoom', finger2Drag: 'pan', doubleTap: 'menu', squeeze: 'menu', puckDoubleTap: 'menu'},
		favorites: ['drawMode', 'connectMode', 'action', 'run', 'undo', 'delete', 'duplicate', 'gestures'],
		menuStyle: 'radial',
		calm: true
	};

	var MAX_FAVORITES = 8;
	var DRAG_THRESHOLD = 8;

	function loadSettings()
	{
		var settings = JSON.parse(JSON.stringify(DEFAULTS));

		try
		{
			var saved = JSON.parse(window.localStorage.getItem('drawkit.input') || 'null');

			if (saved != null)
			{
				for (var key in saved.bindings || {})
				{
					settings.bindings[key] = saved.bindings[key];
				}

				settings.favorites = saved.favorites || settings.favorites;
				settings.menuStyle = saved.menuStyle || settings.menuStyle;
				settings.calm = (saved.calm != null) ? saved.calm : settings.calm;
			}
		}
		catch (e)
		{
			// Uses the defaults
		}

		return settings;
	}

	function saveSettings(settings)
	{
		try
		{
			window.localStorage.setItem('drawkit.input', JSON.stringify(settings));
		}
		catch (e)
		{
			// Settings last until the editor reloads
		}
	}

	function install(ui)
	{
		var graph = ui.editor.graph;
		var container = graph.container;
		var freehand = graph.freehand;
		var settings = loadSettings();
		var drawMode = false;
		var connectMode = false;
		var lastPen = null;

		/**
		 * Commands (menu items and tap actions)
		 */
		function action(name)
		{
			return function()
			{
				var a = ui.actions.get(name);

				if (a != null && a.isEnabled())
				{
					a.funct();
				}
			};
		}

		function flow(name)
		{
			return function()
			{
				if (window.DrawKit != null)
				{
					window.DrawKit[name]();
				}
			};
		}

		var COMMANDS = {
			drawMode: {title: 'Draw', icon: '✏️', run: function() { setDrawMode(!drawMode); },
				isOn: function() { return drawMode; }},
			connectMode: {title: 'Connect', icon: '🔗', run: function() { setConnectMode(!connectMode); },
				isOn: function() { return connectMode; }},
			action: {title: 'Action', icon: '⚡', run: flow('editAction')},
			run: {title: 'Run', icon: '▶️', run: flow('run')},
			stop: {title: 'Stop', icon: '⏹', run: flow('stop')},
			undo: {title: 'Undo', icon: '↩️', run: action('undo')},
			redo: {title: 'Redo', icon: '↪️', run: action('redo')},
			delete: {title: 'Delete', icon: '🗑', run: action('delete')},
			duplicate: {title: 'Duplicate', icon: '⧉', run: action('duplicate')},
			copy: {title: 'Copy', icon: '📄', run: action('copy')},
			paste: {title: 'Paste', icon: '📋', run: action('paste')},
			selectAll: {title: 'Select All', icon: '▣', run: action('selectAll')},
			selectNone: {title: 'Select None', icon: '▢', run: action('selectNone')},
			zoomIn: {title: 'Zoom In', icon: '➕', run: action('zoomIn')},
			zoomOut: {title: 'Zoom Out', icon: '➖', run: action('zoomOut')},
			fit: {title: 'Fit', icon: '⤢', run: action('fitWindow')},
			format: {title: 'Format Panel', icon: '🎨', run: action('format')},
			gestures: {title: 'Gestures', icon: '⚙️', run: function() { openSettings(); }}
		};

		var TAP_OPTIONS = [['none', 'Nothing'], ['rightClick', 'Right-click'], ['menu', 'Menu']];

		for (var id in COMMANDS)
		{
			TAP_OPTIONS.push([id, COMMANDS[id].title]);
		}

		function runTap(binding, x, y, evt)
		{
			if (binding == 'rightClick')
			{
				rightClick(x, y, evt);
			}
			else if (binding == 'menu')
			{
				openMenu(x, y);
			}
			else if (COMMANDS[binding] != null)
			{
				COMMANDS[binding].run();
			}
		}

		/**
		 * Modes
		 */
		function setDrawMode(value)
		{
			drawMode = value;

			if (drawMode)
			{
				connectMode = false;
			}
			else
			{
				stopFreehand();
			}

			updatePuck();
		}

		function setConnectMode(value)
		{
			connectMode = value;

			if (connectMode)
			{
				setDrawMode(false);
			}

			updatePuck();
		}

		// Only turns off freehand drawing that this plugin turned on
		var ownsFreehand = false;

		function startFreehand()
		{
			if (freehand != null && !freehand.isDrawing())
			{
				freehand.setAutoInsert(true);
				freehand.setStopClickEnabled(false);
				freehand.setSelectInserted(false);
				freehand.startDrawing();
				ownsFreehand = true;
			}
		}

		function stopFreehand()
		{
			if (ownsFreehand && freehand != null && freehand.isDrawing() && !freehand.isActive())
			{
				freehand.stopDrawing();
			}

			ownsFreehand = false;
		}

		function freehandToolOpen()
		{
			return ui.freehandWindow != null && ui.freehandWindow.window.isVisible();
		}

		function applyCalm()
		{
			graph.connectionArrowsEnabled = !settings.calm;
			graph.setConnectable(!settings.calm);
		}

		/**
		 * Fingers on the canvas (not on the puck)
		 */
		var fingers = {};
		var fingerCount = 0;
		var blockedFingers = {};

		window.addEventListener('pointerdown', function(evt)
		{
			if (evt.pointerType == 'touch' && !puck.contains(evt.target) && !fingers[evt.pointerId])
			{
				fingers[evt.pointerId] = true;
				fingerCount++;

				// Fingers draw only with draw.io's own Freehand tool
				if (!freehandToolOpen())
				{
					stopFreehand();
				}
			}
		}, true);

		function fingerUp(evt)
		{
			if (fingers[evt.pointerId])
			{
				delete fingers[evt.pointerId];
				fingerCount = Math.max(0, fingerCount - 1);
			}

			if (blockedFingers[evt.pointerId])
			{
				delete blockedFingers[evt.pointerId];
				evt.stopPropagation();
			}
		}

		window.addEventListener('pointerup', fingerUp, true);
		window.addEventListener('pointercancel', fingerUp, true);

		// Fingers that became a Pencil chord no longer reach draw.io
		window.addEventListener('pointermove', function(evt)
		{
			if (blockedFingers[evt.pointerId])
			{
				evt.stopPropagation();
				evt.preventDefault();
			}
		}, true);

		/**
		 * On iPad, draw.io listens to touch and mouse events, not pointer
		 * events, so the touch events of a Pencil gesture that DrawKit
		 * handles (and of fingers in a Pencil chord) are stopped here.
		 * Pointer events come first, so the decision is already made.
		 */
		var penTouchesBlocked = false;
		var fingerTouches = {};
		var blockedTouches = {};

		function filterTouches(evt)
		{
			var stylus = false;
			var blocked = false;

			for (var i = 0; i < evt.changedTouches.length; i++)
			{
				var t = evt.changedTouches[i];

				if (t.touchType == 'stylus')
				{
					stylus = true;
				}
				else
				{
					if (evt.type == 'touchstart' && !puck.contains(evt.target))
					{
						fingerTouches[t.identifier] = true;
					}

					if (blockedTouches[t.identifier])
					{
						blocked = true;
					}
				}
			}

			if ((stylus && penTouchesBlocked) || blocked)
			{
				evt.stopPropagation();

				if (evt.cancelable)
				{
					// Also stops the mouse events made from touches
					evt.preventDefault();
				}
			}

			if (evt.type == 'touchend' || evt.type == 'touchcancel')
			{
				for (var i = 0; i < evt.changedTouches.length; i++)
				{
					var t = evt.changedTouches[i];

					if (t.touchType == 'stylus')
					{
						penTouchesBlocked = false;
					}
					else
					{
						delete fingerTouches[t.identifier];
						delete blockedTouches[t.identifier];
					}
				}
			}
		}

		['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function(name)
		{
			window.addEventListener(name, filterTouches, {capture: true, passive: false});
		});

		// Pinch gestures from a finger plus the Pencil (or the puck)
		['gesturestart', 'gesturechange', 'gestureend'].forEach(function(name)
		{
			window.addEventListener(name, function(evt)
			{
				if (penTouchesBlocked || gesture != null || puckHeld())
				{
					evt.stopPropagation();
					evt.preventDefault();
				}
			}, true);
		});

		// Mouse events made from a blocked Pencil touch
		['mousedown', 'mousemove', 'mouseup'].forEach(function(name)
		{
			window.addEventListener(name, function(evt)
			{
				if (penTouchesBlocked && container.contains(evt.target))
				{
					evt.stopPropagation();
				}
			}, true);
		});

		/**
		 * Pencil routing
		 */
		var gesture = null;

		function consume(evt)
		{
			evt.stopPropagation();
			evt.preventDefault();
		}

		function viewPoint(clientX, clientY)
		{
			return mxUtils.convertPoint(container, clientX, clientY);
		}

		// Pencil is on a selected shape or on one of the selection's handles
		function onSelection(evt)
		{
			var overlay = graph.view.getOverlayPane();

			if (overlay != null && overlay.contains(evt.target))
			{
				return true;
			}

			var pt = viewPoint(evt.clientX, evt.clientY);
			var cell = graph.getCellAt(pt.x, pt.y);

			return cell != null && graph.isCellSelected(cell);
		}

		container.addEventListener('pointerdown', function(evt)
		{
			if (evt.pointerType != 'pen' || freehandToolOpen())
			{
				return;
			}

			lastPen = {x: evt.clientX, y: evt.clientY};
			penTouchesBlocked = false;

			if (drawMode)
			{
				startFreehand();
				return;
			}

			var key = puckHeld() ? 'puck' : (fingerCount == 1 ? 'finger1' : (fingerCount > 1 ? 'finger2' : 'pen'));

			if (key == 'finger1' || key == 'finger2')
			{
				// The fingers' own gesture (scrolling, selecting) stops
				graph.cancelMouseGesture(evt);

				for (var id in fingers)
				{
					blockedFingers[id] = true;
				}

				for (var id in fingerTouches)
				{
					blockedTouches[id] = true;
				}
			}

			var drag = connectMode ? 'connect' : (settings.bindings[key + 'Drag'] || 'none');
			var tap = settings.bindings[key + 'Tap'] || 'none';

			if (drag == 'moveOrPan' && onSelection(evt))
			{
				// draw.io moves, resizes and rotates the selection
				stopFreehand();
				return;
			}
			else if (drag == 'draw')
			{
				startFreehand();
				return;
			}

			stopFreehand();
			consume(evt);
			penTouchesBlocked = true;

			try
			{
				container.setPointerCapture(evt.pointerId);
			}
			catch (e)
			{
				// Keeps working without capture
			}

			gesture = {id: evt.pointerId, drag: drag == 'moveOrPan' ? 'pan' : drag, tap: tap,
				x0: evt.clientX, y0: evt.clientY, x: evt.clientX, y: evt.clientY, moved: false};
		}, true);

		container.addEventListener('pointermove', function(evt)
		{
			if (evt.pointerType == 'pen')
			{
				lastPen = {x: evt.clientX, y: evt.clientY};
			}

			if (gesture == null || evt.pointerId != gesture.id)
			{
				return;
			}

			consume(evt);

			if (!gesture.moved && Math.abs(evt.clientX - gesture.x0) + Math.abs(evt.clientY - gesture.y0) > DRAG_THRESHOLD)
			{
				gesture.moved = true;
				beginDrag(gesture, evt);
			}

			if (gesture.moved)
			{
				updateDrag(gesture, evt);
			}

			gesture.x = evt.clientX;
			gesture.y = evt.clientY;
		}, true);

		function pointerEnd(evt)
		{
			if (gesture == null || evt.pointerId != gesture.id)
			{
				return;
			}

			consume(evt);
			var g = gesture;
			gesture = null;

			if (g.moved)
			{
				endDrag(g, evt, evt.type == 'pointercancel');
			}
			else if (evt.type == 'pointerup')
			{
				runTap(g.tap, evt.clientX, evt.clientY, evt);
			}
		}

		container.addEventListener('pointerup', pointerEnd, true);
		container.addEventListener('pointercancel', pointerEnd, true);

		/**
		 * Drag actions
		 */
		var selectBox = document.createElement('div');
		selectBox.className = 'drawkitSelectBox';

		// Preview line while connecting
		var connectLine = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		connectLine.setAttribute('class', 'drawkitConnectLine');
		var previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		previewLine.setAttribute('stroke', '#0a84ff');
		previewLine.setAttribute('stroke-width', '2');
		previewLine.setAttribute('stroke-dasharray', '6 4');
		connectLine.appendChild(previewLine);

		function beginDrag(g, evt)
		{
			if (g.drag == 'selectBox')
			{
				document.body.appendChild(selectBox);
			}
			else if (g.drag == 'zoom')
			{
				g.scale = graph.view.scale;
			}
			else if (g.drag == 'connect')
			{
				var pt = viewPoint(g.x0, g.y0);
				var cell = graph.getCellAt(pt.x, pt.y);
				var state = (cell != null && graph.getModel().isVertex(cell)) ? graph.view.getState(cell) : null;

				if (state == null)
				{
					g.drag = 'pan';
				}
				else
				{
					g.source = cell;
					g.x0 = container.getBoundingClientRect().left + state.getCenterX() - container.scrollLeft;
					g.y0 = container.getBoundingClientRect().top + state.getCenterY() - container.scrollTop;
					document.body.appendChild(connectLine);
				}
			}
		}

		function updateDrag(g, evt)
		{
			if (g.drag == 'pan')
			{
				container.scrollLeft -= evt.clientX - g.x;
				container.scrollTop -= evt.clientY - g.y;
			}
			else if (g.drag == 'zoom')
			{
				// Zooms around the point where the drag started
				var cr = container.getBoundingClientRect();
				var ax = g.x0 - cr.left, ay = g.y0 - cr.top;
				var t = graph.view.translate, s = graph.view.scale;
				var gx = (ax + container.scrollLeft) / s - t.x;
				var gy = (ay + container.scrollTop) / s - t.y;
				var scale = Math.max(0.1, Math.min(8, g.scale * Math.exp((g.y0 - evt.clientY) / 200)));
				graph.zoomTo(scale);
				t = graph.view.translate;
				s = graph.view.scale;
				container.scrollLeft = (gx + t.x) * s - ax;
				container.scrollTop = (gy + t.y) * s - ay;
			}
			else if (g.drag == 'selectBox')
			{
				selectBox.style.left = Math.min(g.x0, evt.clientX) + 'px';
				selectBox.style.top = Math.min(g.y0, evt.clientY) + 'px';
				selectBox.style.width = Math.abs(evt.clientX - g.x0) + 'px';
				selectBox.style.height = Math.abs(evt.clientY - g.y0) + 'px';
			}
			else if (g.drag == 'connect')
			{
				var line = connectLine.firstChild;
				line.setAttribute('x1', g.x0);
				line.setAttribute('y1', g.y0);
				line.setAttribute('x2', evt.clientX);
				line.setAttribute('y2', evt.clientY);
			}
		}

		function endDrag(g, evt, cancelled)
		{
			if (g.drag == 'selectBox')
			{
				if (selectBox.parentNode != null)
				{
					selectBox.parentNode.removeChild(selectBox);
				}

				if (!cancelled)
				{
					var a = viewPoint(Math.min(g.x0, evt.clientX), Math.min(g.y0, evt.clientY));
					var b = viewPoint(Math.max(g.x0, evt.clientX), Math.max(g.y0, evt.clientY));
					graph.selectRegion(new mxRectangle(a.x, a.y, b.x - a.x, b.y - a.y), evt);
				}
			}
			else if (g.drag == 'connect')
			{
				if (connectLine.parentNode != null)
				{
					connectLine.parentNode.removeChild(connectLine);
				}

				var pt = viewPoint(evt.clientX, evt.clientY);
				var target = cancelled ? null : graph.getCellAt(pt.x, pt.y);

				// Connects to the shape under the Pencil (not to a connector)
				while (target != null && !graph.getModel().isVertex(target))
				{
					target = graph.getModel().getParent(target);
				}

				if (target != null && target != g.source && graph.getModel().isVertex(target))
				{
					var edge = graph.insertEdge(graph.getDefaultParent(), null, '', g.source, target,
						graph.createCurrentEdgeStyle());
					graph.setSelectionCell(edge);
				}
			}
		}

		/**
		 * Right-click: selects the shape under the Pencil and shows its menu
		 */
		function rightClick(x, y, evt)
		{
			var pt = viewPoint(x, y);
			var cell = graph.getCellAt(pt.x, pt.y);

			if (cell == null)
			{
				graph.clearSelection();
			}
			else if (!graph.isCellSelected(cell))
			{
				graph.setSelectionCell(cell);
			}

			var handler = graph.popupMenuHandler;
			handler.hideMenu();
			handler.triggerX = pt.x;
			handler.triggerY = pt.y;
			handler.popup(x, y, cell, evt || new MouseEvent('contextmenu', {clientX: x, clientY: y}));
		}

		/**
		 * Puck
		 */
		var puck = document.createElement('div');
		puck.className = 'drawkitPuck';
		puck.setAttribute('role', 'button');
		document.body.appendChild(puck);

		var held = {};
		var heldCount = 0;
		var lastTap = 0;
		var puckDrag = null;
		var pos = null;

		try
		{
			pos = JSON.parse(window.localStorage.getItem('drawkit.puckPos') || 'null');
		}
		catch (e)
		{
			// Default position
		}

		function puckHeld()
		{
			return heldCount > 0;
		}

		function placePuck(x, y)
		{
			x = Math.max(4, Math.min(window.innerWidth - 68, x));
			y = Math.max(4, Math.min(window.innerHeight - 68, y));
			puck.style.left = x + 'px';
			puck.style.top = y + 'px';
			pos = {x: x, y: y};
		}

		function updatePuck()
		{
			var mode = drawMode ? 'Draw' : (connectMode ? 'Connect' : null);
			puck.classList.toggle('held', puckHeld());
			puck.classList.toggle('mode', mode != null);
			puck.innerHTML = puckHeld() ? 'Select' : (mode != null ? mode + '<br><small>mode</small>' : 'Hold to<br>select');
			puck.setAttribute('aria-label', mode != null ? mode + ' mode' : 'Hold to select with Apple Pencil');
		}

		placePuck(pos != null ? pos.x : 16, pos != null ? pos.y : window.innerHeight * 0.55);
		updatePuck();
		window.addEventListener('resize', function() { placePuck(pos.x, pos.y); });

		puck.addEventListener('pointerdown', function(evt)
		{
			consume(evt);

			try
			{
				puck.setPointerCapture(evt.pointerId);
			}
			catch (e)
			{
				// Keeps working without capture
			}

			if (!held[evt.pointerId])
			{
				held[evt.pointerId] = true;
				heldCount++;
			}

			puckDrag = {id: evt.pointerId, x: evt.clientX, y: evt.clientY, left: pos.x, top: pos.y, moved: false};
			updatePuck();
		});

		puck.addEventListener('pointermove', function(evt)
		{
			if (puckDrag != null && puckDrag.id == evt.pointerId)
			{
				var dx = evt.clientX - puckDrag.x, dy = evt.clientY - puckDrag.y;

				if (puckDrag.moved || Math.abs(dx) + Math.abs(dy) > 12)
				{
					puckDrag.moved = true;
					placePuck(puckDrag.left + dx, puckDrag.top + dy);
				}
			}
		});

		function puckRelease(evt)
		{
			if (!held[evt.pointerId])
			{
				return;
			}

			delete held[evt.pointerId];
			heldCount = Math.max(0, heldCount - 1);

			if (puckDrag != null && puckDrag.id == evt.pointerId)
			{
				if (puckDrag.moved)
				{
					try
					{
						window.localStorage.setItem('drawkit.puckPos', JSON.stringify(pos));
					}
					catch (e)
					{
						// Position resets next time
					}
				}
				else if (evt.type == 'pointerup')
				{
					var now = Date.now();

					if (now - lastTap < 350)
					{
						lastTap = 0;
						runTap(settings.bindings.puckDoubleTap, pos.x + 32, pos.y + 32);
					}
					else
					{
						lastTap = now;
					}
				}

				puckDrag = null;
			}

			updatePuck();
		}

		puck.addEventListener('pointerup', puckRelease);
		puck.addEventListener('pointercancel', puckRelease);
		puck.addEventListener('lostpointercapture', puckRelease);
		puck.addEventListener('contextmenu', function(evt) { evt.preventDefault(); });

		/**
		 * Menu: ring of favourites, grid of everything
		 */
		var overlay = null;

		function closeMenu()
		{
			if (overlay != null)
			{
				overlay.parentNode.removeChild(overlay);
				overlay = null;
			}
		}

		function createOverlay()
		{
			closeMenu();
			overlay = document.createElement('div');
			overlay.className = 'drawkitMenuOverlay';

			overlay.addEventListener('pointerdown', function(evt)
			{
				if (evt.target == overlay)
				{
					consume(evt);
					closeMenu();
				}
			});

			document.body.appendChild(overlay);

			return overlay;
		}

		function commandButton(id, className)
		{
			var cmd = COMMANDS[id];
			var button = document.createElement('button');
			button.className = className + ((cmd.isOn != null && cmd.isOn()) ? ' on' : '');
			button.innerHTML = '<span class="icon"></span><span class="label"></span>';
			button.querySelector('.icon').textContent = cmd.icon;
			button.querySelector('.label').textContent = cmd.title;

			button.addEventListener('click', function(evt)
			{
				consume(evt);
				closeMenu();
				cmd.run();
			});

			return button;
		}

		function openMenu(x, y)
		{
			if (x == null || y == null)
			{
				x = (lastPen != null) ? lastPen.x : window.innerWidth / 2;
				y = (lastPen != null) ? lastPen.y : window.innerHeight / 2;
			}

			var favorites = settings.favorites.filter(function(id) { return COMMANDS[id] != null; })
				.slice(0, MAX_FAVORITES);

			if (settings.menuStyle == 'grid' || favorites.length == 0)
			{
				openGrid();
				return;
			}

			var radius = 84;
			x = Math.max(radius + 36, Math.min(window.innerWidth - radius - 36, x));
			y = Math.max(radius + 36, Math.min(window.innerHeight - radius - 36, y));
			var o = createOverlay();

			for (var i = 0; i < favorites.length; i++)
			{
				var angle = -Math.PI / 2 + i * 2 * Math.PI / favorites.length;
				var button = commandButton(favorites[i], 'drawkitRingItem');
				button.style.left = (x + radius * Math.cos(angle) - 32) + 'px';
				button.style.top = (y + radius * Math.sin(angle) - 32) + 'px';
				o.appendChild(button);
			}

			var more = document.createElement('button');
			more.className = 'drawkitRingCenter';
			more.textContent = '•••';
			more.setAttribute('aria-label', 'All commands');
			more.style.left = (x - 26) + 'px';
			more.style.top = (y - 26) + 'px';

			more.addEventListener('click', function(evt)
			{
				consume(evt);
				openGrid();
			});

			o.appendChild(more);
		}

		function openGrid()
		{
			var o = createOverlay();
			var panel = document.createElement('div');
			panel.className = 'drawkitGrid';

			for (var id in COMMANDS)
			{
				panel.appendChild(commandButton(id, 'drawkitGridItem'));
			}

			o.appendChild(panel);
		}

		/**
		 * Gestures settings
		 */
		function select(options, value)
		{
			var s = document.createElement('select');

			for (var i = 0; i < options.length; i++)
			{
				var o = document.createElement('option');
				o.value = options[i][0];
				o.textContent = options[i][1];
				s.appendChild(o);
			}

			s.value = value;

			return s;
		}

		function row(parent, title, control)
		{
			var label = document.createElement('label');
			label.className = 'drawkitRow';
			var span = document.createElement('span');
			span.textContent = title;
			label.appendChild(span);
			label.appendChild(control);
			parent.appendChild(label);
		}

		function heading(parent, text)
		{
			var h = document.createElement('div');
			h.className = 'drawkitHeading';
			h.textContent = text;
			parent.appendChild(h);
		}

		function openSettings()
		{
			closeMenu();
			var div = document.createElement('div');
			div.className = 'drawkitDialog drawkitSettings';
			var body = document.createElement('div');
			body.className = 'drawkitFields';
			div.appendChild(body);

			heading(body, 'Gestures');
			var inputs = {};

			for (var i = 0; i < INPUTS.length; i++)
			{
				var input = INPUTS[i];
				inputs[input.id] = select(input.kind == 'drag' ? DRAG_OPTIONS : TAP_OPTIONS,
					settings.bindings[input.id]);
				row(body, input.title, inputs[input.id]);
			}

			heading(body, 'Menu');
			var style = select([['radial', 'Ring of favourites (••• for all)'], ['grid', 'Grid of all commands']],
				settings.menuStyle);
			row(body, 'Style', style);

			var commandOptions = [['', '(empty)']];

			for (var id in COMMANDS)
			{
				commandOptions.push([id, COMMANDS[id].title]);
			}

			var favorites = [];

			for (var i = 0; i < MAX_FAVORITES; i++)
			{
				favorites.push(select(commandOptions, settings.favorites[i] || ''));
				row(body, 'Favourite ' + (i + 1), favorites[i]);
			}

			heading(body, 'Touch');
			var calm = document.createElement('input');
			calm.type = 'checkbox';
			calm.checked = settings.calm;
			row(body, 'Calm touch (no connection arrows or points; connect from the menu)', calm);

			var buttons = document.createElement('div');
			buttons.className = 'drawkitButtons';

			var reset = mxUtils.button('Reset', function()
			{
				settings = JSON.parse(JSON.stringify(DEFAULTS));
				saveSettings(settings);
				applyCalm();
				ui.hideDialog();
			});
			reset.className = 'geBtn';

			var cancel = mxUtils.button(mxResources.get('cancel'), function() { ui.hideDialog(); });
			cancel.className = 'geBtn';

			var save = mxUtils.button(mxResources.get('save'), function()
			{
				for (var id in inputs)
				{
					settings.bindings[id] = inputs[id].value;
				}

				settings.menuStyle = style.value;
				settings.favorites = favorites.map(function(s) { return s.value; }).filter(function(v) { return v != ''; });
				settings.calm = calm.checked;
				saveSettings(settings);
				applyCalm();
				ui.hideDialog();
			});
			save.className = 'geBtn gePrimaryBtn';

			buttons.appendChild(reset);
			buttons.appendChild(cancel);
			buttons.appendChild(save);
			div.appendChild(buttons);

			ui.showDialog(div, 420, Math.min(640, window.innerHeight - 80), true, true);
		}

		/**
		 * Styles
		 */
		var css = document.createElement('style');
		css.textContent = '.drawkitPuck{position:fixed;width:64px;height:64px;border-radius:50%;z-index:6;' +
			'touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;' +
			'display:flex;align-items:center;justify-content:center;flex-direction:column;' +
			'font:600 11px -apple-system,system-ui,sans-serif;text-align:center;line-height:1.1;' +
			'background:rgba(255,255,255,.92);color:#111;border:2px solid #c7c7cc;' +
			'box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .08s,background .08s}' +
			'.drawkitPuck small{font-weight:400;font-size:9px}' +
			'.drawkitPuck.held{background:#0a84ff;border-color:#0a84ff;color:#fff;transform:scale(1.12)}' +
			'.drawkitPuck.mode:not(.held){border-color:#ff9500;box-shadow:0 0 0 3px rgba(255,149,0,.35),0 4px 14px rgba(0,0,0,.18)}' +
			'.drawkitSelectBox{position:fixed;z-index:6;border:1.5px dashed #0a84ff;background:rgba(10,132,255,.1);' +
			'pointer-events:none}' +
			'.drawkitConnectLine{position:fixed;inset:0;width:100vw;height:100vh;z-index:6;pointer-events:none}' +
			'.drawkitMenuOverlay{position:fixed;inset:0;z-index:20;touch-action:none}' +
			'.drawkitRingItem,.drawkitRingCenter,.drawkitGridItem{font:500 10px -apple-system,system-ui,sans-serif;' +
			'border:1px solid #c7c7cc;background:rgba(255,255,255,.97);color:#111;cursor:pointer;' +
			'box-shadow:0 4px 14px rgba(0,0,0,.18);display:flex;flex-direction:column;align-items:center;' +
			'justify-content:center;gap:2px;padding:0}' +
			'.drawkitRingItem{position:absolute;width:64px;height:64px;border-radius:50%}' +
			'.drawkitRingItem .icon,.drawkitGridItem .icon{font-size:20px;line-height:1}' +
			'.drawkitRingCenter{position:absolute;width:52px;height:52px;border-radius:50%;font-size:16px}' +
			'.drawkitRingItem.on,.drawkitGridItem.on{background:#ff9500;border-color:#ff9500;color:#fff}' +
			'.drawkitGrid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;' +
			'grid-template-columns:repeat(auto-fill,76px);gap:8px;width:min(520px,calc(100vw - 32px));' +
			'max-height:calc(100vh - 64px);overflow:auto;padding:12px;border-radius:16px;' +
			'background:rgba(242,242,247,.97);box-shadow:0 10px 40px rgba(0,0,0,.25);box-sizing:border-box;' +
			'justify-content:center}' +
			'.drawkitGridItem{width:76px;height:68px;border-radius:12px}' +
			'.drawkitSettings .drawkitRow{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
			'font-weight:400}' +
			'.drawkitSettings .drawkitRow span{flex:1}' +
			'.drawkitSettings .drawkitRow select{width:55%}' +
			'.drawkitSettings .drawkitRow input[type=checkbox]{width:auto}' +
			'.drawkitHeading{font-weight:700;font-size:14px;margin-top:8px}' +
			'@media (prefers-color-scheme: dark){.drawkitPuck,.drawkitRingItem,.drawkitRingCenter,' +
			'.drawkitGridItem{background:rgba(44,44,46,.97);color:#f2f2f7;border-color:#48484a}' +
			'.drawkitGrid{background:rgba(28,28,30,.97)}}';
		document.head.appendChild(css);

		applyCalm();

		window.DrawKitInput = {
			// Apple Pencil double-tap and squeeze from the app
			pencil: function(kind, x, y)
			{
				if (overlay != null)
				{
					closeMenu();
					return;
				}

				if (x == null || y == null)
				{
					x = (lastPen != null) ? lastPen.x : null;
					y = (lastPen != null) ? lastPen.y : null;
				}

				runTap(settings.bindings[kind] || 'none', x, y);
			},
			// The editor resets some options when a flow loads
			applySettings: applyCalm,
			openMenu: openMenu,
			openSettings: openSettings,
			setDrawMode: setDrawMode,
			setConnectMode: setConnectMode,
			isPuckHeld: puckHeld,
			commands: COMMANDS,
			getSettings: function() { return JSON.parse(JSON.stringify(settings)); },
			puck: puck
		};
	}

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
