var util = require('util'),
    colors = require('colors'),
    os = require('os'),
    path = require('path'),
    fs = require('fs'),
    extend = require('extend'),
    exec = require('child-process-promise').exec,
    exec1 = require('child_process').exec,
    spawn = require('child-process-promise').spawn,
    isText = require('istextorbinary'),
    _ = require('lodash');

/* classes */
var EventEmitter = require('events').EventEmitter;
var utils = require('./utils');

var exports = {};

/* global static vars */
var DIFF_PATH = exports.DIFF_PATH = null;
var DIFF_BIN = exports.DIFF_BIN = 'diff';

/* if we need to extract diff path or not */
var useDiffFinder = exports.useDiffFinder = true;

/* setting for the diff temporary file dir */
var tempDir = exports.tempDir = path.join(process.cwd(), 'tmp');

/* use unified diff, or nah */
var useUnifiedDiff = exports.unifiedDiff = true;

function getDiffPath(callback) {
  if (os.platform() == 'win32')
  {
    exports.DIFF_PATH = path.join(__dirname, '..', 'bin', 'diff-win', 'bin');
    exports.DIFF_BIN = 'diff.exe';

    // only using diff.exe on win
    if (
      !useDiffFinder &&
      (!fs.existsSync(path.join(exports.DIFF_PATH, 'diff.exe')))
    )
    {
      utils.error('ERROR: diff path does not exist. see localdiff.js');
      throw new Error("ERROR: diff not found");
    }

    if (callback)
      callback(exports.DIFF_PATH);
  }
  else /* try mac / linux method of executing it */
  {
    exec('which diff').then(function (result) {
      var stdout = result.stdout+"";
      var stderr = result.stderr+"";

      console.log('stdout: ', stdout);
      console.log('stderr: ', stderr);

      if (fs.existsSync(stdout.trim()))
      {
        exports.DIFF_PATH = path.join();
        if (callback)
          callback(exports.DIFF_PATH);
      }
      else
      {
        utils.error('ERROR: diff path not found by which: ', err);
        if (!useDiffFinder)
          throw new Error("ERROR: diff path not found");
      }
    })
    .fail(function (err) {
      utils.error('ERROR: diff path not found, which didn\'t work: ', err);
      if (!useDiffFinder)
        throw new Error("ERROR: diff path not found");
    })
    .progress(function (childProcess) {
      utils.debug('which childProcess.pid: ', childProcess.pid);
    });
  }
}

// todo: automatically unlink tempfiles based on preference
// maybe save all revisions in a seperate dir or for later use.. (optionally)
function diff(p, previous, cb) {
  if (!exports.DIFF_PATH)
  {
    utils.debug("calling diff finder..");

    getDiffPath(function(){
      commandLine(path, previous, latest, cb);
    });
  }
  else
  {
    // de-base64 from previous.
    if (!Buffer.isBuffer(previous))
      previous = new Buffer(previous);

    // check if it's a text file we're trying to diff
    if (isText.isTextSync(path, previous))
    {
      var previousTemp = path.join(exports.tempDir, _.uniqueId(path.basename(p)));
      //fs.writeFileSync( path.join(exports.tempDir, 'test-input-previous.txt'), previous);

      fs.writeFile(previousTemp, previous, function (err) {
        if (err) {
          utils.error(err);
          return;
        }

        // try the diff from the temporary to current
        var args = [previousTemp, p];
        if (exports.unifiedDiff)
          args.push('-u');

        var command = (exports.DIFF_BIN + ' ' + args.join(' ')).trim();
        utils.debug("diff cmd:"+command);

        var opts = {
          env: { PATH: exports.DIFF_PATH }
        }

        exec1(command, opts, function (err, stdout, stderr) {
          if (!stdout && (err && err == "")) {
            utils.error('diff error: ', err.toString(), "msg: "+": \n"+err.toString());
            utils.error(JSON.stringify({
              out: stdout.toString(),
              err: stderr.toString(),
              bug: true
            }));

            if (cb)
              cb(false, { code: 'EDIFFERROR', cmd: command, path: p });

            return;

          }

          var latest = null;
          //utils.debug('got diff:');
          //utils.debug(JSON.stringify({ err: stderr.toString(), out: stdout.toString() }));

          // test mode
          try { latest = fs.readFileSync(p); } catch (ex) { latest = new Buffer("error: "+ex); utils.warn('could not read: ', ex); }
          
          var key = (p+'').toLowerCase().replace(/\W/g, '');
          cb(true, { key: key, timestamp: new Date().getTime(), path: p, text: latest, diff: stdout.toString(), tmp: previousTemp });
        })

        /*
        exec(command).then(function (result) {
          var latest = null;
          utils.debug('got diff:');
          utils.debug(JSON.stringify({ err: result.stderr.toString(), out: result.stdout.toString() }));

          try { latest = fs.readFileSync(p).toString(); } catch (ex) { latest = "err"; utils.warn('could not read: ', ex); }

          var key = (p+'').toLowerCase().replace(/\W/g, '');
          cb(true, { key: key, path: p, previous: previous.toString(), latest: latest.toString(), diff: result.stdout.toString() });
        })
        .fail(function(err){
          utils.debug('diff: ', err.toString(), "output: \n"+err.stderr.tOString());
          if (cb)
            cb(false, { code: 'EDIFFERROR', cmd: command, path: p });
        });
        */
      }.bind(this));
    }
    else
    {
      utils.debug('not a text file so can\'t use diff - todo: handle this.. or not.');
      if (cb)
        cb(false, { code: 'ENOTTEXT', path: p });
    }
  }
}

var fns = {
  getDiffPath: getDiffPath,
  diff: diff
};
extend(exports, fns);

module.exports = exports;
