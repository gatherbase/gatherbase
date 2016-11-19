var debug = require('debug')('gatherbase:discover:chef');
var async = require('async');
var _ = require('lodash');
var request = require('request');



// Helper function to handle request and errors that occur
var handleRequest = function(err, res, log, url, callback) {
  if (err) {
    callback(err);

    return false;
  } else if (res.statusCode !== 200) {
    log('cannot retrieve URL ' + url);
    //var httpErr = new Error('HTTP error response ' + res.statusCode);
    //httpErr.response = res;
    //callback(httpErr);

    callback();

    return false;
  }

  return true;
};

// Retrieve given cookbooks
var getCookbooks = function(list, exclude, parallelLimit, retrieve, log, callback) {
  async.eachLimit(list.items, parallelLimit, function(item, callback) {
    request.get({
      url: item.cookbook
    }, function(err, res, body) {
      if (handleRequest(err, res, log, item.cookbook, callback) === false) return;

      var cookbook = JSON.parse(body);

      async.eachLimit(cookbook.versions, 1, function(versionUrl, callback) {
        var cookbookVersion = _.last(versionUrl.split('/'));

        if (!_.isEmpty(exclude[cookbook.name]) && _.includes(exclude[cookbook.name], cookbookVersion)) {
          return callback();
        }

        request.get({
          url: versionUrl
        }, function(err, res, body) {
          if (handleRequest(err, res, log, versionUrl, callback) === false) return;

          var version = JSON.parse(body);

          var rJobData = {
            properties: {
              name: cookbook.name + ' Chef cookbook',
              chef_cookbook_name: cookbook.name,
              revision: version.version,
              uris: [
                'https://supermarket.chef.io/cookbooks/' + cookbook.name,
                'https://supermarket.chef.io/cookbooks/' + cookbook.name + '/download',
                'https://supermarket.chef.io/cookbooks/' + cookbook.name + '/versions/' + version.version,
                'https://supermarket.chef.io/cookbooks/' + cookbook.name + '/versions/' + version.version + '/download',
                versionUrl,
                version.cookbook,
                version.file
              ],
              labels: [
                'Chef cookbook'
              ],
              info_url: 'https://supermarket.chef.io/cookbooks/' + cookbook.name,
              package_url: version.file,
              deprecated: cookbook.deprecated,
              created: cookbook.created_at,
              updated: cookbook.updated_at,
              description: cookbook.description,
              //full_name: cookbook.name + ' cookbook (Chef Supermarket)',
              maintainer: { name: cookbook.maintainer },
              license: version.license,
              chef_foodcritic_failure: cookbook.foodcritic_failure,
              chef_up_for_adoption: cookbook.up_for_adoption
            },
            config: {
              retrieve_urls: [
                {
                  url: version.file,
                  file_size: version.tarball_file_size,
                  //file_name
                  access: 'http',
                  extract: true
                }
              ]
            }
          };

          rJobData.properties.rating = cookbook.average_rating;
          rJobData.properties.followers_count = cookbook.metrics.followers;
          rJobData.properties.downloads_count = cookbook.metrics.downloads.total;
          rJobData.properties.downloads_count_revision = cookbook.metrics.downloads.versions[version.version];

          //if (!_.isEmpty(version.dependencies)) rJobData.properties.requires = { all_of: version.dependencies };

          if (cookbook.replacement) {
            rJobData.properties.chef_replacement = { url: cookbook.replacement };
          }

          if (cookbook.external_url || cookbook.source_url) {
            rJobData.properties.repository_url = cookbook.external_url || cookbook.source_url;
          }

          if (cookbook.issues_url || cookbook.external_url) {
            rJobData.properties.issues_url = cookbook.issues_url || cookbook.external_url;
          }

          if (cookbook.source_url) {
            rJobData.properties.chef_source_url = cookbook.source_url;
          }

          if (!_.isEmpty(cookbook.category)) {
            rJobData.properties.labels.push(cookbook.category);
          }

          if (_.endsWith(cookbook.latest_version, version.version)) {
            rJobData.properties.latest = true;
          }

          retrieve(rJobData, callback);
        });
      }, callback);
    });
  }, callback);
};



module.exports = function(spec) {
  debug('new instance of ChefDiscoverer', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  var entryPoint = spec.config.entryPoint || 'https://supermarket.chef.io/api/v1/cookbooks';
  var parallelLimit = spec.config.parallelLimit || 1;
  var cookbooksPerPage = spec.config.cookbooksPerPage || 50;
  var exclude = spec.config.exclude || {};

  obj.discover = function(retrieve, log, progress, done) {
    debug('discovery initiated');

    var total;
    var start = 0;

    // Initial request of first part of list of cookbooks
    request.get({
      url: entryPoint,
      qs: { items: cookbooksPerPage }
    }, function(err, res, body) {
      if (handleRequest(err, res, log, entryPoint, done) === false) return;

      var list = JSON.parse(body);
      total = list.total;

      // Get initial set of cookbooks
      getCookbooks(list, exclude, parallelLimit, retrieve, log, function(err) {
        if (err) return done(err);

        debug('progress: ' + cookbooksPerPage + ' of ' + total);
        progress(cookbooksPerPage, total);

        // Request further parts of list of cookbooks
        async.until(function() {
          return start > total;
        }, function(callback) {
          start = start + cookbooksPerPage;

          request.get({
            url: entryPoint,
            qs: { items: cookbooksPerPage, start: start }
          }, function(err, res, body) {
            if (handleRequest(err, res, log, entryPoint, callback) === false) return;

            var list = JSON.parse(body);

            getCookbooks(list, exclude, parallelLimit, retrieve, log, function(err) {
              if (err) return callback(err);

              var cookbooksDone = start + cookbooksPerPage;
              debug('progress: ' + cookbooksDone + ' of ' + total);
              progress(cookbooksDone, total);

              callback();
            });
          });
        }, function(err) {
          if (!err) log(total + ' Chef cookbooks successfully discovered');

          done(err);
        });
      });
    });
  };

  return obj;
};
