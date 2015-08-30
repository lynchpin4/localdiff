var path = require('path');

/*
// LocalDiff config file

var config = {
  "project": "localdiff-node",
  "dataDir": "/localdiff/",
  "workingDir": "/localdiff/",
  /*"ignored": /node_modules|\.git/,
  "ignored": /[\/\\]\./
  
  .default('path', path.join(process.cwd()))
  .default('dataPath', path.join(process.cwd()))
  .default('saverevisions', true)
  .default('dbrevisions', false)
  .default('usemongo', false)
  .describe('path', "folder with the files to watch and create a diff log for")
};

module.exports = config;

lol
*/

function ConfigurationBuilder(args) {
  this.args = args;
  this.createConfig();
}

ConfigurationBuilder.prototype.createConfig = function() {
  
  this.config = {
    "project": path.basename(this.args.dataPath),
    "path": this.args.path,
    "dataDir": path.join(this.args.dataPath, ".localdiff"),
    "workingDir": this.args.path,
    "dbrevisions": this.args.dbrevisions,
    "usemongo": this.args.usemongo
  };
  
  return this.config;
}

ConfigurationBuilder.prototype.toJson = function() {
  return JSON.stringify(this.config);
}

module.exports = ConfigurationBuilder;