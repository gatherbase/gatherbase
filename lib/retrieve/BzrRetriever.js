var debug = require('debug')('gatherbase:retrieve:bzr');
var uuid = require('uuid');
var path = require('path');
var exec = require('child_process').exec;


module.exports = function(spec) {
  debug('new instance of BzrRetriever', spec);

  var obj = {};

  obj.retrieve = function(url, hJobData, log, progress, callback) {
    var repoUrl = url.url;
    var subDir = uuid.v4();
    var destDir = path.join(hJobData.base, subDir);

    var child = exec('bzr branch ' + repoUrl + ' ' + destDir, function(err, stdout, stderr) {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;

        return callback(err);
      }

      hJobData.dirs.push({ url: url.url, name: subDir });

      log('dir ' + subDir + ' stored to ' + hJobData.base);

      callback(null, hJobData);
    });
  };

  return obj;
};
