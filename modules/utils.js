var util = require('util'),
    colors = require('colors');

// heh..
global.DiffWatchUtils = {
  debug: true
};

global.DiffWatchUtils.success = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.green(m));
}

global.DiffWatchUtils.info = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

    util.log(colors.white(m));
  }

global.DiffWatchUtils.debug = function(m)
{
  if (!global.DiffWatchUtils.debug) return;

  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.cyan(m));
}

global.DiffWatchUtils.warn = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.yellow(m));
}

global.DiffWatchUtils.error = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.red(m));
}

module.exports = global.DiffWatchUtils;
