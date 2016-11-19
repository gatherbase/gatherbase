var debug = require('debug')('gatherbase:handle:export');
var _ = require('lodash');
var async = require('async');
var fs = require('fs-extra');
var path = require('path');
var yaml = require('js-yaml');



module.exports = function(spec) {
  debug('new instance of ExportHandler', spec);

  var homePath = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;

  spec = spec || {};
  spec.config = spec.config || {};
  spec.config.path = spec.config.path || path.join(homePath, 'export.txt');
  spec.config.format = spec.config.format || 'json';

  var obj = {};

  obj.handle = function(hJobData, log, progress, done) {
    var impl = hJobData.properties;

    async.series([
      function(done) {
        fs.mkdirs(path.dirname(spec.config.path), done);
      },
      function(done) {
        var str;

        if (spec.config.format === 'yaml' || spec.config.format === 'yml') str = yaml.safeDump(impl, { skipInvalid: true });
        else str = JSON.stringify(impl, null, 2);

        fs.writeFile(spec.config.path, str, done);
      }
    ], function(err) {
      done(err, hJobData);
    });
  };

  return obj;
};
