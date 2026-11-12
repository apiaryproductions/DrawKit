/**
 * DrawKit input plugin: Apple Pencil, the puck, the radial menu and
 * customisable gestures.
 *
 * - Every Pencil gesture on the canvas is routed by the bindings in
 *   settings (Gestures in the menu): which drag or tap action runs depends
 *   on whether the puck, fingers on the canvas or fingers on the control pad
 *   are held down.
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

	var SLIDE_OPTIONS = [
		['none', 'Nothing'],
		['pan', 'Pan'],
		['zoom', 'Zoom (slide up and down)'],
		['rotate', 'Rotate selection (slide sideways)']
	];

	var MENU_OPTIONS = [
		['next', 'Highlight next item'],
		['run', 'Run highlighted item'],
		['close', 'Close menu']
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
		{id: 'puckDoubleTap', title: 'Puck double-tap', kind: 'tap'},
		{id: 'menuDoubleTap', title: 'Pencil double-tap while the menu is open', kind: 'menu'},
		{id: 'menuSqueeze', title: 'Pencil squeeze while the menu is open', kind: 'menu'},
		{id: 'pad1Drag', title: 'Finger 1 + Pencil drag', kind: 'drag', group: 'Control pad (sidebar): 1 to 4 fingers on it'},
		{id: 'pad1Tap', title: 'Finger 1 + Pencil tap', kind: 'tap'},
		{id: 'pad1Slide', title: 'Finger 1 slide', kind: 'slide'},
		{id: 'pad1DoubleTap', title: 'Finger 1 double-tap', kind: 'tap'},
		{id: 'pad2Drag', title: 'Finger 2 + Pencil drag', kind: 'drag'},
		{id: 'pad2Tap', title: 'Finger 2 + Pencil tap', kind: 'tap'},
		{id: 'pad2Slide', title: 'Finger 2 slide', kind: 'slide'},
		{id: 'pad2DoubleTap', title: 'Finger 2 double-tap', kind: 'tap'},
		{id: 'pad3Drag', title: 'Finger 3 + Pencil drag', kind: 'drag'},
		{id: 'pad3Tap', title: 'Finger 3 + Pencil tap', kind: 'tap'},
		{id: 'pad3Slide', title: 'Finger 3 slide', kind: 'slide'},
		{id: 'pad3DoubleTap', title: 'Finger 3 double-tap', kind: 'tap'},
		{id: 'pad4Drag', title: 'Finger 4 + Pencil drag', kind: 'drag'},
		{id: 'pad4Tap', title: 'Finger 4 + Pencil tap', kind: 'tap'},
		{id: 'pad4Slide', title: 'Finger 4 slide', kind: 'slide'},
		{id: 'pad4DoubleTap', title: 'Finger 4 double-tap', kind: 'tap'}
	];

	// Colour for each number of fingers on the control pad (CMYK)
	var PAD_COLORS = ['#00AEEF', '#EC008C', '#FFD400', '#111111'];
	var MAX_PAD_FINGERS = 4;

	var DEFAULTS = {
		bindings: {penDrag: 'moveOrPan', penTap: 'none', puckDrag: 'selectBox', puckTap: 'rightClick',
			finger1Drag: 'zoom', finger2Drag: 'pan', doubleTap: 'menu', squeeze: 'menu', puckDoubleTap: 'menu',
			pad1Drag: 'selectBox', pad1Tap: 'rightClick', pad1Slide: 'pan', pad1DoubleTap: 'menuNext',
			pad2Drag: 'pan', pad2Tap: 'none', pad2Slide: 'zoom', pad2DoubleTap: 'none',
			pad3Drag: 'connect', pad3Tap: 'menu', pad3Slide: 'rotate', pad3DoubleTap: 'none',
			pad4Drag: 'none', pad4Tap: 'none', pad4Slide: 'none', pad4DoubleTap: 'none',
			menuDoubleTap: 'next', menuSqueeze: 'run'},
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

		var TAP_OPTIONS = [['none', 'Nothing'], ['rightClick', 'Right-click'], ['menu', 'Menu'],
			['menuNext', 'Menu, then next item'], ['menuRun', 'Run highlighted menu item']];

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
				(overlay != null) ? closeMenu() : openMenu(x, y);
			}
			else if (binding == 'menuNext')
			{
				(overlay != null) ? advanceRing() : openMenu(x, y);
			}
			else if (binding == 'menuRun')
			{
				runHighlighted();
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

			var key = puckHeld() ? 'puck' : (pad.count > 0 ? 'pad' + Math.min(pad.count, MAX_PAD_FINGERS) :
				(fingerCount == 1 ? 'finger1' : (fingerCount > 1 ? 'finger2' : 'pen')));

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
				zoomAround(g.x0, g.y0, g.scale * Math.exp((g.y0 - evt.clientY) / 200));
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

		function zoomAround(clientX, clientY, scale)
		{
			var cr = container.getBoundingClientRect();
			var ax = clientX - cr.left, ay = clientY - cr.top;
			var t = graph.view.translate, s = graph.view.scale;
			var gx = (ax + container.scrollLeft) / s - t.x;
			var gy = (ay + container.scrollTop) / s - t.y;
			graph.zoomTo(Math.max(0.1, Math.min(8, scale)));
			t = graph.view.translate;
			s = graph.view.scale;
			container.scrollLeft = (gx + t.x) * s - ax;
			container.scrollTop = (gy + t.y) * s - ay;
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
		 * Control pad in the app's sidebar: the app reports how many fingers
		 * are on it (1, 2 or 3) and how they move
		 */
		var pad = {count: 0, rotation: 0, touch: null, lastTap: {}};
		var ROTATE_STEP = 15;

		function padSlide(binding, dx, dy)
		{
			if (binding == 'pan')
			{
				container.scrollLeft -= dx * 1.5;
				container.scrollTop -= dy * 1.5;
			}
			else if (binding == 'zoom')
			{
				var cr = container.getBoundingClientRect();
				zoomAround(cr.left + cr.width / 2, cr.top + cr.height / 2,
					graph.view.scale * Math.exp(-dy / 150));
			}
			else if (binding == 'rotate')
			{
				// Turns in 15 degree steps, one undo step each
				pad.rotation += dx * 0.75;

				while (Math.abs(pad.rotation) >= ROTATE_STEP)
				{
					var step = (pad.rotation > 0) ? ROTATE_STEP : -ROTATE_STEP;
					pad.rotation -= step;
					rotateSelection(step);
				}
			}
		}

		function rotateSelection(degrees)
		{
			var cells = graph.getSelectionCells().filter(function(c) { return graph.getModel().isVertex(c); });

			if (cells.length == 0)
			{
				return;
			}

			graph.getModel().beginUpdate();

			try
			{
				for (var i = 0; i < cells.length; i++)
				{
					var style = graph.getCurrentCellStyle(cells[i]);
					var angle = (parseFloat(style[mxConstants.STYLE_ROTATION] || 0) + degrees + 360) % 360;
					graph.setCellStyles(mxConstants.STYLE_ROTATION, angle, [cells[i]]);
				}
			}
			finally
			{
				graph.getModel().endUpdate();
			}
		}

		function handlePad(phase, a, b)
		{
			if (phase == 'count')
			{
				var count = Math.max(0, Math.round(a || 0));
				var now = Date.now();

				if (pad.count == 0 && count > 0)
				{
					pad.touch = {time: now, max: count, moved: 0};
				}
				else if (pad.touch != null && count > pad.touch.max)
				{
					pad.touch.max = count;
				}

				// A short touch without movement is a tap; two quick taps with
				// the same number of fingers a double-tap
				if (count == 0 && pad.touch != null)
				{
					var t = pad.touch;
					var n = Math.min(t.max, MAX_PAD_FINGERS);
					pad.touch = null;

					if (t.moved < 8 && now - t.time < 300)
					{
						if (now - (pad.lastTap[n] || 0) < 400)
						{
							pad.lastTap[n] = 0;
							runTap(settings.bindings['pad' + n + 'DoubleTap'], null, null);
						}
						else
						{
							pad.lastTap = {};
							pad.lastTap[n] = now;
						}
					}
					else
					{
						pad.lastTap = {};
					}
				}

				pad.count = count;
				pad.rotation = 0;
				updatePuck();
			}
			else if (phase == 'move' && pad.count > 0)
			{
				if (pad.touch != null)
				{
					pad.touch.moved += Math.abs(a || 0) + Math.abs(b || 0);
				}

				padSlide(settings.bindings['pad' + Math.min(pad.count, MAX_PAD_FINGERS) + 'Slide'], a || 0, b || 0);
			}
		}

		/**
		 * Banner at the top that says what the fingers on the control pad do
		 */
		var banner = document.createElement('div');
		banner.className = 'drawkitBanner';
		banner.style.display = 'none';

		// Sits in the toolbar after its buttons, or at the top without a toolbar
		var toolbar = (ui.toolbar != null) ? ui.toolbar.container : null;

		if (toolbar != null)
		{
			banner.classList.add('inToolbar');
			toolbar.appendChild(banner);
		}
		else
		{
			document.body.appendChild(banner);
		}

		function optionTitle(options, value)
		{
			for (var i = 0; i < options.length; i++)
			{
				if (options[i][0] == value)
				{
					return options[i][1];
				}
			}

			return 'Nothing';
		}

		// Short form for the banner: "Zoom (slide up and down)" becomes "Zoom"
		function shortTitle(options, value)
		{
			return optionTitle(options, value).replace(/\s*\(.*\)$/, '');
		}

		function updateBanner()
		{
			if (pad.count == 0)
			{
				banner.style.display = 'none';
				return;
			}

			var n = Math.min(pad.count, MAX_PAD_FINGERS);
			var b = settings.bindings;
			var color = PAD_COLORS[n - 1];
			banner.style.display = '';
			banner.style.borderColor = color;
			banner.innerHTML = '<span class="dot"></span><b></b><span class="text"></span>';
			banner.querySelector('.dot').style.background = color;
			banner.querySelector('b').textContent = 'Finger ' + n;
			banner.querySelector('.text').textContent = 'Drag: ' + shortTitle(DRAG_OPTIONS, b['pad' + n + 'Drag']) +
				' · Tap: ' + shortTitle(TAP_OPTIONS, b['pad' + n + 'Tap']) +
				' · Slide: ' + shortTitle(SLIDE_OPTIONS, b['pad' + n + 'Slide']);
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
			puck.classList.toggle('held', puckHeld() || pad.count > 0);
			puck.classList.toggle('mode', mode != null);
			var padLabel = (pad.count > 0) ? 'Finger ' + Math.min(pad.count, MAX_PAD_FINGERS) : null;
			puck.style.background = (padLabel != null && !puckHeld()) ? PAD_COLORS[Math.min(pad.count, MAX_PAD_FINGERS) - 1] : '';
			puck.style.borderColor = puck.style.background;
			puck.style.color = (padLabel != null && !puckHeld() && pad.count != 3) ? '#fff' : '';
			updateBanner();
			puck.innerHTML = puckHeld() ? 'Select' : (padLabel != null ? padLabel :
				(mode != null ? mode + '<br><small>mode</small>' : 'Hold to<br>select'));
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

		// Ring items and the one highlighted by repeated Pencil double-taps
		var ring = {items: [], index: -1};

		function closeMenu()
		{
			if (overlay != null)
			{
				overlay.parentNode.removeChild(overlay);
				overlay = null;
			}

			ring = {items: [], index: -1};
		}

		function runHighlighted()
		{
			var item = (ring.index >= 0) ? ring.items[ring.index] : null;
			closeMenu();

			if (item != null)
			{
				COMMANDS[item.id].run();
			}
		}

		function advanceRing()
		{
			if (ring.items.length > 0)
			{
				if (ring.index >= 0)
				{
					ring.items[ring.index].button.classList.remove('hl');
				}

				ring.index = (ring.index + 1) % ring.items.length;
				ring.items[ring.index].button.classList.add('hl');
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

					// A Pencil tap anywhere runs the highlighted item
					var item = (evt.pointerType == 'pen' && ring.index >= 0) ? ring.items[ring.index] : null;
					closeMenu();

					if (item != null)
					{
						COMMANDS[item.id].run();
					}
				}
			});

			// Stops the mouse events Safari makes from the tap, which would
			// otherwise reach the shape under the closed menu
			overlay.addEventListener('touchstart', function(evt)
			{
				if (evt.target == overlay && evt.cancelable)
				{
					evt.preventDefault();
				}
			}, {passive: false});

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
				ring.items.push({id: favorites[i], button: button});
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
				if (input.group != null)
				{
					heading(body, input.group);
				}

				inputs[input.id] = select(input.kind == 'drag' ? DRAG_OPTIONS : (input.kind == 'slide' ? SLIDE_OPTIONS :
					(input.kind == 'menu' ? MENU_OPTIONS : TAP_OPTIONS)), settings.bindings[input.id]);
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
			'.drawkitBanner{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:7;max-width:calc(100vw - 24px);' +
			'padding:8px 14px;border-radius:12px;border:3px solid;background:rgba(255,255,255,.97);color:#111;' +
			'font:13px -apple-system,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:none;' +
			'display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
			'.drawkitBanner .dot{width:14px;height:14px;border-radius:50%;flex:none}' +
			'.drawkitBanner .text{overflow:hidden;text-overflow:ellipsis}' +
			'.drawkitBanner.inToolbar{position:static;transform:none;box-shadow:none;display:inline-flex;' +
			'vertical-align:middle;margin-left:10px;padding:2px 10px;border-width:2px;border-radius:8px;' +
			'max-width:calc(100% - 640px);min-width:120px;font-size:12px;line-height:20px;box-sizing:border-box}' +
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
			'.drawkitRingItem.hl{outline:3px solid #0a84ff;outline-offset:2px;transform:scale(1.12)}' +
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
			'@media (prefers-color-scheme: dark){.drawkitPuck,.drawkitRingItem,.drawkitRingCenter,.drawkitBanner,' +
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
					var binding = settings.bindings[kind == 'squeeze' ? 'menuSqueeze' : 'menuDoubleTap'];
					var item = (ring.index >= 0) ? ring.items[ring.index] : null;

					if (binding == 'next' && ring.items.length > 0)
					{
						advanceRing();
					}
					else if (binding == 'run' && item != null)
					{
						runHighlighted();
					}
					else
					{
						closeMenu();
					}

					return;
				}

				if (x == null || y == null)
				{
					x = (lastPen != null) ? lastPen.x : null;
					y = (lastPen != null) ? lastPen.y : null;
				}

				runTap(settings.bindings[kind] || 'none', x, y);
			},
			// Control pad in the app's sidebar
			pad: handlePad,
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
