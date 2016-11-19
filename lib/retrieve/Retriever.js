var fs = require('fs-extra');
var temp = require('temp').track();
var _ = require('lodash');
var debug = require('debug')('gatherbase:retrieve');
var uuid = require('uuid');
var path = require('path');
var async = require('async');

var HttpRetriever = require('./HttpRetriever');
var GitRetriever = require('./GitRetriever');
var BzrRetriever = require('./BzrRetriever');

var retrievers = {
  http: HttpRetriever,
  https: HttpRetriever,
  git: GitRetriever,
  bzr: BzrRetriever
};



module.exports = function(spec) {
  debug('new instance of Retriever', spec);

  var obj = {};

  spec.config = spec.config || {};
  spec.config.destination = spec.config.destination || temp.path();

  obj.retrieve = function(rJobData, log, progress, done) {
    var hJobData = {
      base: path.join(spec.config.destination, uuid.v4()),
      files: [],
      dirs: []
    };

    var conf = _.cloneDeep(spec.config);

    _.merge(conf, rJobData.config);

    // Base path to be used for clean-up in case job fails
    rJobData.base = hJobData.base;

    if (_.isEmpty(conf.retrieve_urls)) {
      return done(null, hJobData);
    }

    var count = 0;
    var total = _.size(conf.retrieve_urls);

    try {
      fs.mkdirsSync(hJobData.base);
    } catch(err) {
      return done(err);
    }

    async.eachSeries(conf.retrieve_urls, function(url, callback) {
      if (!url.access) return callback();

      if (!retrievers[url.access]) {
        return callback(new Error('cannot retrieve ' + url.url + ' because ' + url.access + ' is unknown'));
      }

      var r = retrievers[url.access](conf);

      r.retrieve(url, hJobData, log, progress, function(err, hJobDataUpd) {
        if (err) return callback(err);

        hJobData = hJobDataUpd;

        count++;
        progress(count, total);
        log('successfully retrieved ' + count + ' of ' + total + ': ' + url.url);

        callback();
      });
    }, function(err) {
      done(err, hJobData);
      //if (err) return done(err);
      //spec.status.addIds(rJobData.properties.uris, function(err) {
      //  if (err) return done(err);
      //  spec.status.setStatus(_.first(rJobData.properties.uris), rJobData.properties.revision, 'retrieved', function(err) {
      //    if (err) return done(err);
      //    done(null, hJobData);
      //  });
      //});
    });
  };

  return obj;
};
