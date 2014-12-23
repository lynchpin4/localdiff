var util = require('util'),
    colors = require('colors');

var DiffWatchUtils = {
  debug: true
};

DiffWatchUtils.success = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.green(m));
}

DiffWatchUtils.info = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

    util.log(colors.white(m));
  }

DiffWatchUtils.debug = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.cyan(m));
}

DiffWatchUtils.warn = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.yellow(m));
}

DiffWatchUtils.error = function(m)
{
  if (arguments.length > 1)
  {
    m = Array.prototype.slice.call(arguments);
  }

  if (util.isArray(m))
    m = m.join(' ');

  util.log(colors.red(m));
}

module.exports = global.DiffWatchUtils || DiffWatchUtils;
