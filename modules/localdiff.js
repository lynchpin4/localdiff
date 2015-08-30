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
  console.log('and the platform is: '+os.platform());
  if (os.platform() == 'win32')
  {
    exports.DIFF_PATH = path.join(__dirname, '..', 'bin', 'diff-win', 'bin');
    exports.DIFF_BIN = 'diff.exe';

    // only using diff.exe on win
    if (!useDiffFinder && (!fs.existsSync(path.join(exports.DIFF_PATH, 'diff.exe'))))
    {
      utils.error('ERROR: diff path does not exist. see localdiff.js');
      throw new Error("ERROR: diff not found");
    }

    if (callback)
      callback(exports.DIFF_PATH);
  }
  else /* try mac / linux method of executing it */
  {
    var search = process.env.PATH.split(":");
    
    var whichPath;
    var diffPath;
    search.forEach(function(folder) {
      if (fs.existsSync(path.join(folder, "which")))
      {
        whichPath = path.join(folder, "which");
      }
      
      // test test
      if (fs.existsSync(path.join(folder, "diff")))
      {
        diffPath = path.join(folder, "diff");
      }
    });
    
    /*console.log("found full paths: ");
    console.log(whichPath);
    console.log(diffPath);*/
    
    exports.DIFF_PATH = diffPath;
    console.log(colors.green('Diff path on this OS: '+exports.DIFF_PATH));
    
    // off t
    if (callback)
      callback(exports.DIFF_PATH);
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
    // todo: async waterfall
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
          env: { PATH: path.dirname(exports.DIFF_PATH) }
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
          utils.debug('got diff:');
          console.dir({ err: stderr.toString(), out: stdout.toString() });

          // test mode
          try { latest = fs.readFileSync(p); } catch (ex) { latest = new Buffer("error: "+ex); utils.warn('could not read: ', ex); }
          
          var key = (p+'').toLowerCase().replace(/\W/g, '');
          cb(true, { key: key, timestamp: new Date().getTime(), path: p, text: latest, diff: stdout.toString(), tmp: previousTemp });
        });
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
