/**
 * misc.js
 * Miscellaneous utilities
 * @author convincedd, ryanli, LA-MJ, CatzHoek
 */

'use strict';

/* eslint-disable */
if (!this.Foxtrick)
	var Foxtrick = {};
/* eslint-enable */

Foxtrick.startListenToChange = function(doc) {
	if (!Foxtrick.isHt(doc))
		return;

	let waitForChanges = function(changes) {
		if (!changes || !changes.length)
			return;

		let [first] = changes;
		let doc = first.ownerDocument;
		Foxtrick.stopListenToChange(doc);
		Foxtrick.entry.change(doc, changes);
		Foxtrick.startListenToChange(doc);
	};

	// must store MO on contentWindow
	// otherwise it's killed by Firefox's GC
	let win = doc.defaultView;
	let obs = win._FoxtrickObserver;
	if (obs) {
		obs.reconnect();
	}
	else {
		let content = doc.getElementById('content');
		win._FoxtrickObserver = Foxtrick.getChanges(content, waitForChanges);

		/**
		 * @this {Window}
		 */
		let beforeUnload = () => {
			if (this._FoxtrickObserver) {
				this._FoxtrickObserver.disconnect();
				delete this._FoxtrickObserver;
			}
		};
		win.addEventListener('beforeunload', beforeUnload);
	}
};

Foxtrick.stopListenToChange = function(doc) {
	let win = doc.defaultView;
	let obs = win._FoxtrickObserver;
	if (obs)
		obs.disconnect();
};

Foxtrick.preventChange = function(doc, func) {
	/**
	 * @this {object}
	 */
	return function(...args) {
		Foxtrick.stopListenToChange(doc);
		func.apply(this, args);
		Foxtrick.startListenToChange(doc);
	};
};

/**
 * A hack to enable passing Error instances over the message port.
 *
 * @param  {Error|object} err An Error instance here, an object there
 * @return {object|Error}     An object here, an Error instance there
 */
Foxtrick.jsonError = (err) => {
	const ERROR_SYMBOL = '__ftErrorSymbol';
	if (err == null)
		return err;

	if (typeof err == 'object') {
		if (err instanceof Error) {
			return {
				[ERROR_SYMBOL]: 1,
				name: err.name,
				message: err.message,
				stack: err.stack,
			};
		}
		else if (ERROR_SYMBOL in err) {
			let obj = new window[err.name]();
			obj.message = err.message;
			obj.stack = err.stack;
			return obj;
		}

		for (let k of Object.keys(err))
			err[k] = Foxtrick.jsonError(err[k]);

	}

	return err;
};

/**
 * Try playing an audio url
 * @param {string} url
 */
Foxtrick.playSound = function(url) {
	let play = function(url, type, volume) {
		try {
			let music = new Audio();
			let canPlay = music.canPlayType('audio/' + type);
			Foxtrick.log('can play', type, ':', canPlay === '' ? 'no' : canPlay);

			if (canPlay === '' || canPlay === 'no')
				return;

			music.src = url;
			music.volume = volume;
			music.play();
		}
		catch (e) {
			Foxtrick.log('Playback failed', e);
		}
	};

	if (Foxtrick.context == 'content') {
		// delegate to background due to playback delay
		Foxtrick.SB.ext.sendRequest({ req: 'playSound', url: url });
		return;
	}

	if (typeof url !== 'string') {
		Foxtrick.log('Bad sound:', url);
		return;
	}
	let soundUrl = url.replace(/^foxtrick:\/\//, Foxtrick.ResourcePath);

	let type = 'wav';
	if (soundUrl.indexOf('data:audio/') === 0) {
		let dataURLRe = /^data:audio\/(.+?);/;
		if (!dataURLRe.test(soundUrl)) {
			Foxtrick.log('Bad data URL:', soundUrl);
			return;
		}

		type = dataURLRe.exec(soundUrl)[1];
	}
	else {
		let extRe = /\.([^.]+)$/;
		if (!extRe.test(soundUrl)) {
			Foxtrick.log('Not a sound file:', url);
			return;
		}

		type = extRe.exec(soundUrl)[1];
	}

	let volume = (parseInt(Foxtrick.Prefs.getString('volume'), 10) || 100) / 100;
	Foxtrick.log('play', volume, soundUrl.slice(0, 100));

	play(soundUrl, type, volume);
};

/**
 * Copy something to the clipboard.
 *
 * Must be used in a listener for a user-initiated event.
 * Use addCopying instead
 *
 * copy maybe a string or a function that returns a string or {mime, content}
 * mime may specify additional mime type
 * 'text/plain' is always used
 *
 * c.f. https://stackoverflow.com/questions/3436102/copy-to-clipboard-in-chrome-extension/12693636#12693636
 *
 * @param {document} doc
 * @param {string}   copy {string|function}
 * @param {string}   mime {string?}
 */
Foxtrick.copy = function(doc, copy, mime) {
	if (Foxtrick.platform == 'Safari') {
		// FIXME needs testing
		Foxtrick.sessionSet('clipboard', copy);
		Foxtrick.error('Safari copying is untested');
		return;
	}

	const DEFAULT_MIME = 'text/plain';
	var contentMime = null;
	var copyContent = '';

	if (typeof copy === 'function') {
		let ret = copy();
		if (ret && typeof ret === 'object') {
			contentMime = ret.mime || null;
			copyContent = ret.content;
		}
		else {
			copyContent = ret;
		}
	}
	else {
		contentMime = mime || null;
		copyContent = copy;
	}

	doc.addEventListener('copy', function(ev) {

		ev.clipboardData.setData(DEFAULT_MIME, copyContent);
		if (contentMime)
			ev.clipboardData.setData(contentMime, copyContent);

		ev.preventDefault();

	}, { once: true });

	doc.execCommand('Copy', false, null);
};

Foxtrick.newTab = function(url) {
	var tab;

	if (Foxtrick.context === 'content') {
		Foxtrick.SB.ext.sendRequest({ req: 'newTab', url: url });
	}
	else if (Foxtrick.platform == 'Firefox') {
		tab = window.gBrowser.addTab(url);
		window.gBrowser.selectedTab = tab;
	}
	else if (Foxtrick.platform == 'Android') {
		tab = window.BrowserApp.addTab(url);
		window.BrowserApp.selectedTab = tab;
	}
	return tab;
};

/**
 * @param  {XMLDocument}   xml
 * @param  {string}        containerPath
 * @param  {string}        valueAttr
 * @param  {Array<string>} attributes
 * @return {Array<object>}
 */
Foxtrick.xmlEval = function(xml, containerPath, valueAttr, ...attributes) {
	if (!xml)
		return [];

	let pathParts = containerPath.split(/\/|\[/g);
	let last = pathParts.pop(), base = xml;
	for (let part of pathParts) {
		let nodes = base.getElementsByTagName(part);
		[base] = nodes;
	}

	var ret = [];
	let nodes = base.getElementsByTagName(last);
	for (let node of nodes) {
		let label = node.getAttribute(valueAttr);
		let values = attributes.map(a => node.getAttribute(a));
		if (values.length)
			ret.push([label, ...values]);
		else
			ret.push(label);
	}

	return ret;
};

/**
 * @param  {XMLDocument} xml
 * @param  {string}      path
 * @param  {string}      attribute
 * @return {Node|string}
 */
Foxtrick.xmlEvalSingle = function(xml, path, attribute) {
	let result = xml.evaluate(path, xml, null, xml.DOCUMENT_NODE, null);
	let node = result.singleNodeValue;
	if (!node)
		return null;

	if (attribute)
		return node.attributes.getNamedItem(attribute).textContent;

	return node;
};

Foxtrick.version = '0.0.0';
Foxtrick.lazyProp(Foxtrick, 'version', function() {
	// get rid of user-imported value
	Foxtrick.Prefs.deleteValue('version');
	return Foxtrick.Prefs.getString('version');
});

Foxtrick.branch = 'dev';
Foxtrick.lazyProp(Foxtrick, 'branch', function() {
	// get rid of user-imported value
	Foxtrick.Prefs.deleteValue('branch');
	return Foxtrick.Prefs.getString('branch');
});

/**
 * Clear all caches
 */
Foxtrick.clearCaches = function() {
	Foxtrick.sessionDeleteBranch('');
	Foxtrick.localDeleteBranch('');
	Foxtrick.cache.clear();
};

Foxtrick.getHref = function(doc) {
	return doc.location.href;
};

/**
 * @param  {string}  url
 * @param  {string}  param
 * @return {?string}      ?value
 */
Foxtrick.getUrlParam = function(url, param) {
	let needle = param.toLowerCase();
	let params = new URL(url).searchParams;
	let entries = [...params]; // keys() is not iterable in FF :(
	let entry = Foxtrick.nth(([k]) => k.toLowerCase() == needle, entries);
	if (entry) {
		let [_, val] = entry; // lgtm[js/unused-local-variable]
		return val;
	}

	return null;
};

Foxtrick.isHt = function(doc) {
	return Foxtrick.getPanel(doc) !== null && doc.getElementById('aspnetForm') !== null;
};

Foxtrick.isHtUrl = function(url) {
	const HT_RES = [
		/^(https?:)?\/\/(www(\d{2})?\.)?hattrick\.org(\/|$)/i,
		/^(https?:)?\/\/stage\.hattrick\.org(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.ws(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.bz(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hat-trick\.net(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.uol\.com\.br(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.interia\.pl(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.name(\/|$)/i,
		/^(https?:)?\/\/www(\d{2})?\.hattrick\.fm(\/|$)/i,
	];
	return Foxtrick.any(re => re.test(url), HT_RES);
};

Foxtrick.isStage = function(doc) {
	const STAGE_RE = /^https?:\/\/stage\.hattrick\.org(\/|$)/i;
	return STAGE_RE.test(Foxtrick.getHref(doc));
};

Foxtrick.isLoginPage = function(doc) {
	let teamLinks = doc.getElementById('teamLinks');
	if (teamLinks === null)
		return true;
	if (teamLinks.getElementsByTagName('a').length === 0)
		return true;

	return false;
};

Foxtrick.getPanel = function(doc) {
	return doc.querySelector('.hattrick, .hattrickNoSupporter');
};

/**
 * Test whether object obj has a property prop
 *
 * Deals with non-objects and null.
 * Traverses prototype chain.
 *
 * @param  {object}  obj
 * @param  {string}  prop
 * @return {Boolean}
 */
Foxtrick.hasProp = function(obj, prop) {
	return obj != null && typeof obj === 'object' && prop in obj;
};

/**
 * Test whether object obj is a simple key-value map
 *
 * @param  {object}  obj
 * @return {Boolean}
 */
Foxtrick.isMap = function(obj) {
	if (obj == null)
		return false;

	let proto = Object.getPrototypeOf(obj);
	return proto == null || proto == Object.prototype;
};

/**
 * Test whether object obj is an array-like
 *
 * @param  {object}  obj
 * @return {Boolean}
 */
Foxtrick.isArrayLike = function(obj) {
	return Foxtrick.hasProp(obj, 'length');
};

/**
 * Copy all members from modified to original.
 * Modifies original.
 * @param {object} original
 * @param {object} modified
 */
Foxtrick.mergeAll = function(original, modified) {
	let hasOwnProperty = {}.hasOwnProperty;
	if (original && typeof original === 'object' &&
	    modified && typeof modified === 'object') {
		for (let mem in modified) {
			if (hasOwnProperty.call(modified, mem))
				original[mem] = modified[mem];
		}
	}
};

/**
 * Overwrite members in original with members from modified.
 * Modifies original. No new members added.
 * @param  {object} original
 * @param  {object} modified
 */
Foxtrick.mergeValid = function(original, modified) {
	let hasOwnProperty = {}.hasOwnProperty;
	if (original && typeof original === 'object' &&
	    modified && typeof modified === 'object') {
		for (let mem in original) {
			if (hasOwnProperty.call(modified, mem))
				original[mem] = modified[mem];
		}
	}
};

Foxtrick.setLastPage = function(host) {
	Foxtrick.Prefs.setString('last-page', String(host));
};

Foxtrick.getLastPage = function() {
	return Foxtrick.Prefs.getString('last-page') || 'http://www.hattrick.org';
};

/**
 * Insert text in given textarea at the current position of the cursor
 * @param {HTMLTextAreaElement} textarea
 * @param {string}              text
 */
Foxtrick.insertAtCursor = function(textarea, text) {
	let val = textarea.value;
	let before = val.slice(0, textarea.selectionStart);
	let after = val.slice(textarea.selectionEnd);
	textarea.value = before + text + after;
	textarea.dispatchEvent(new Event('input'));
};

Foxtrick.confirmDialog = function(msg) {
	if (Foxtrick.arch === 'Gecko')
		return Services.prompt.confirm(null, null, msg);

	// eslint-disable-next-line no-alert
	return window.confirm(msg);
};

Foxtrick.alert = function(msg) {
	if (Foxtrick.arch === 'Gecko') {
		Services.prompt.alert(null, null, msg);
		return;
	}
	// eslint-disable-next-line no-alert
	window.alert(msg);
};

// only gecko
Foxtrick.reloadAll = function() {
	// reload ht tabs
	if (Foxtrick.platform == 'Firefox') {
		let browserEnumerator = Services.wm.getEnumerator('navigator:browser');

		// Check each browser instance for our URL
		while (browserEnumerator.hasMoreElements()) {
			let browserWin = browserEnumerator.getNext();
			let tabbrowser = browserWin.getBrowser();

			// Check each tab of this browser instance
			let numTabs = tabbrowser.browsers.length;
			for (let index = 0; index < numTabs; index++) {
				let currentBrowser = tabbrowser.getBrowserAtIndex(index);
				let url = currentBrowser.currentURI.spec;
				if (Foxtrick.isHtUrl(url)) {
					currentBrowser.reload();
					Foxtrick.log('reload: ', url);
				}
				else if (/^chrome:\/\/foxtrick/.test(url)) {
					currentBrowser.contentWindow.close();
					index--;
					numTabs--;
				}
			}
		}
	}
};


// gecko: find first occurence of host and open+focus there
Foxtrick.openAndReuseOneTabPerURL = function(url, reload) {
	/* global Services */
	try {
		let origin = new URL(url).origin;

		let browserEnumerator = Services.wm.getEnumerator('navigator:browser');

		// Check each browser instance for our URL
		let found = false;
		while (!found && browserEnumerator.hasMoreElements()) {
			let browserWin = browserEnumerator.getNext();
			let tabbrowser = browserWin.getBrowser();

			// Check each tab of this browser instance
			let numTabs = tabbrowser.browsers.length;
			for (let index = 0; index < numTabs; index++) {
				let currentBrowser = tabbrowser.getBrowserAtIndex(index);
				let url = currentBrowser.currentURI.spec;
				let matches = url.indexOf(origin) == 0;
				Foxtrick.log('tab:', url, 'is searched url:', origin, '=', matches);
				if (!matches)
					continue;

				// The URL is already opened. Select this tab.
				tabbrowser.selectedTab = tabbrowser.mTabs[index];

				// Focus *this* browser-window
				browserWin.focus();
				if (reload) {
					browserWin.loadURI(url);
					Foxtrick.log('reload:', url);
				}

				found = true;
				break;
			}
		}

		// Our URL isn't open. Open it now.
		if (!found) {
			let recentWindow = Services.wm.getMostRecentWindow('navigator:browser');
			if (recentWindow) {
				// Use an existing browser window
				recentWindow.delayedOpenTab(url, null, null, null, null);
			}
			else {
				// No browser windows are open, so open a new one.
				Foxtrick.log('open new window:', url);
				window.open(url);
			}
		}
	}
	catch (e) { Foxtrick.log(e); }
};
Foxtrick.encodeBase64 = function(str) {
	return window.btoa(unescape(encodeURIComponent(str)));
};

Foxtrick.decodeBase64 = function(str) {
	try {
		return decodeURIComponent(escape(window.atob(str)));
	}
	catch (e) {
		Foxtrick.log('Error decoding base64 encoded string', str, e);
		return null;
	}
};

/**
 * Save an array of arrays of bytes/chars as a file.
 *
 * Default name: foxtrick.txt
 * Default mime: text/plain;charset=utf-8'
 * @param {document} doc
 * @param {Array}    arr  array of arrays of bytes/chars
 * @param {string}   name file name
 * @param {string}   mime mime type + charset
 */
Foxtrick.saveAs = function(doc, arr, name, mime) {
	let win = doc.defaultView;
	let blob = new win.Blob(arr, { type: mime || 'text/plain;charset=utf-8' });
	let url = win.URL.createObjectURL(blob);
	let link = doc.createElement('a');
	link.href = url;
	link.download = name || 'foxtrick.txt';
	link.dispatchEvent(new MouseEvent('click'));
};

/**
 * requestAnimationFrame wrapper
 * Finds rAF and attaches cb callback to it
 * Ensures $this in cb refers to the window
 * @param  {Window}   win
 * @param  {function} cb
 */
Foxtrick.rAF = function(win, cb) {
	if (typeof win !== 'object') {
		Foxtrick.error('rAF needs a window!');
		return;
	}
	var rAF = win.requestAnimationFrame || win.mozRequestAnimationFrame ||
		win.webkitRequestAnimationFrame;

	if (typeof rAF !== 'function') {
		Foxtrick.error('No rAF defined!');
		return;
	}
	if (typeof cb !== 'function') {
		Foxtrick.error('rAF needs a callback!');
		return;
	}

	rAF(function() {
		try {
			cb.call(win);
		}
		catch (e) {
			Foxtrick.log('Error in callback for rAF', e);
		}
	});
};


Foxtrick.getSpecialtyImagePathFromNumber = function(type, negative) {
	let base = Foxtrick.InternalPath + 'resources/img/matches/spec';
	let url = base + type;
	if (negative)
		url += '_red';

	if (Foxtrick.Prefs.getBool('anstoss2icons'))
		url += '_alt';

	return url + '.png';
};

/**
 * Given a number in decimal representation, returns its roman representation
 * Source: http://blog.stevenlevithan.com/archives/javascript-roman-numeral-converter
 *
 * @param  {number}  num
 * @return {string}
 */
Foxtrick.decToRoman = function(num) {
	if (isNaN(num))
		return '';

	const KEY = [
		'',
		'C',
		'CC',
		'CCC',
		'CD',
		'D',
		'DC',
		'DCC',
		'DCCC',
		'CM',
		'',
		'X',
		'XX',
		'XXX',
		'XL',
		'L',
		'LX',
		'LXX',
		'LXXX',
		'XC',
		'',
		'I',
		'II',
		'III',
		'IV',
		'V',
		'VI',
		'VII',
		'VIII',
		'IX',
	];

	let str = Number(num).toString();
	let digits = str.split('').map(d => Number(d));
	if (str[0] == '-')
		digits.shift();

	let roman = [];
	let i = 3;
	while (i--)
		roman.unshift(KEY[digits.pop() + i * 10] || '');

	roman.unshift('M'.repeat(digits.join('')));
	if (str[0] == '-')
		roman.unshift('-');

	return roman.join('');
};
