var fs = require('fs-extra');
var debug = require('debug')('gatherbase:handle:cleanup');



module.exports = function(spec) {
  debug('new instance of CleanupHandler', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  obj.handle = function(jobData, log, progress, done) {
    if (!jobData || !jobData.base) return done();

    fs.remove(jobData.base, function(err) {
      if (err) return done(err);

      if (spec.config.base && spec.config.base !== jobData.base) fs.remove(spec.config.base, done);
      else done();
    });
  };

  return obj;
};
