var path = require('path'),
	plist = require('plist'),
	execFile = require('child_process').execFile,
	authorize = require('./build/Release/hdiutil.node').authorize;

function forAsync(iterator, begin, end, step) {

	if (arguments.length < 3) end = Infinity;

	if (!begin) begin = 0;
	if (!step) step = 1;

	var calls = 0,
		idle = true,

		it = function() {
			calls += 1;
			if (idle) {
				idle = false;

				while (calls > 0) {
					calls -= 1;

					iterator((it.iteration += step) <= end ? it : null, it.iteration);

				}

				idle = true;
			}
		};

	it.iteration = -step + begin;


	it();
}

function requestPassword(prompt, ret) {
	if (typeof prompt !== 'string') prompt = String(prompt);
	if (typeof ret !== 'function') ret = function(){};
	authorize(prompt, ret);
}

function info(imagePath, ret) {
	if (typeof imagePath !== 'string') imagePath = String(imagePath);
	if (typeof ret !== 'function') ret = function(){};
	execFile('/usr/bin/hdiutil', [
		'info',
		'-plist'
	], function(error, result) {
		if (error) return ret(error);
		result = plist.parse(result).images.filter(image => image['image-path'] === imagePath)[0];
		if (!result) return ret(null);
		result = result['system-entities'].filter(entity => entity.hasOwnProperty('mount-point'))[0];
		ret(null, result['mount-point'], result['dev-entry']);
	});
}

function isEncrypted(imagePath, ret) {
	execFile('/usr/bin/hdiutil', [
		'isencrypted',
		imagePath,
		'-plist'
	], function(error, result) {
		if (!error) try {
			result = plist.parse(result).encrypted;
		} catch (exception) {
			error = exception;
			result = false;
		}
		ret(error, result);
	});
}

function attach(imagePath, ret, options) {
	if (typeof imagePath !== 'string') imagePath = String(imagePath);
	if (typeof ret !== 'function') ret = function(){};
	info(imagePath, function(error, mountPath, devicePath) {
		if (error) return ret(error);
		if (mountPath) return ret(null);
		isEncrypted(imagePath, function(error, encrypted) {
			if (error) return ret(error);

			if (typeof options !== 'object') options = {};

			var prompt = options.prompt,
				password = options.password,
				args = ['attach', imagePath, '-plist', '-stdinpass'],
				repeatTimes = (encrypted && typeof password !== 'string' && options.repeat);

			if (typeof repeatTimes !== 'number' ||
				isNaN(repeatTimes) ||
				repeatTimes < 0 ||
				repeatTimes % 1) {
				repeatTimes = 0;
			}

			if (typeof prompt !== 'string') {
				prompt = 'Enter password to access ' + path.basename(imagePath);
			}

			if (options.readonly) args.push('-readonly');
			if (options.nobrowse) args.push('-nobrowse');
			args.push(options.autoopen ? '-autoopen' : '-noautoopen');

			forAsync(function(repeat) {

				var proc = execFile('/usr/bin/hdiutil', args, function(error, result, errorMsg) {

					if (repeatTimes > repeat.iteration && errorMsg.indexOf('Authentication error') !== -1)
						return repeat();

					if (error) ret(error); else ret(null);

				});

				if (encrypted) {

					proc.stdin.setEncoding('UTF-8');

					if (typeof password === 'string') {
						proc.stdin.write(password);
						proc.stdin.end();
					}

					else requestPassword(prompt, function(password, cancelled) {

						if (!cancelled) {
							proc.stdin.write(password);
							proc.stdin.end();
						}

						else proc.kill('SIGINT');


					});



				}

			}, 0, Infinity);


		});
	});
}

function detach(imagePath, ret, force) {
	if (typeof imagePath !== 'string') imagePath = String(imagePath);
	if (typeof ret !== 'function') ret = function(){};
	info(imagePath, function(error, mountPath, devicePath) {
		if (error) return ret(error);
		if (!devicePath) return ret(null);
		var args = ['detach', devicePath];
		if (force) args.push('-force');
		execFile('/usr/bin/hdiutil', args, ret);
	});
}

module.exports = {
	info: info,
	attach: attach,
	detach: detach
};