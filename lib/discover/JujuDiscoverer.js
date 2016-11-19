var debug = require('debug')('gatherbase:discover:juju');
var async = require('async');
var _ = require('lodash');
var request = require('request');

// API docs: https://github.com/juju/charmstore/blob/v5-unstable/docs/API.md



// Helper function to handle request and errors that occur
var handleRequest = function(err, res, callback) {
  if (err) {
    callback(err);

    return false;
  } else if (res.statusCode !== 200) {
    var httpErr = new Error('HTTP error response ' + res.statusCode);
    httpErr.response = res;

    callback(httpErr);

    return false;
  }

  return true;
};



module.exports = function(spec) {
  debug('new instance of JujuDiscoverer', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  //var entryPoint = spec.config.entryPoint || 'https://jujucharms.com/q/?type=charm';
  var charmstoreBase = spec.config.charmstoreBase || 'https://jujucharms.com';
  var apiBase = spec.config.apiBase || 'https://api.jujucharms.com/v5';
  //var apiMetaQuery = spec.config.apiMetaQuery || 'include=charm-metadata&include=charm-config&include=manifest&include=stats&include=tags&include=extra-info&include=archive-upload-time';
  var apiMetaQuery = spec.config.apiMetaQuery || 'include=archive-size&include=archive-upload-time&include=bundle-machine-count&include=bundle-metadata&include=bundle-unit-count&include=bundles-containing&include=can-ingest&include=charm-actions&include=charm-config&include=charm-metadata&include=charm-metrics&include=common-info&include=extra-info&include=hash&include=hash256&include=id&include=id-name&include=id-revision&include=id-series&include=id-user&include=manifest&include=owner&include=perm&include=promulgated&include=published&include=resources&include=revision-info&include=stats&include=supported-series&include=tags&include=terms';
  // derived from: https://api.jujucharms.com/v5/precise/mysql-55/meta/
  var apiList = spec.config.apiList || apiBase + '/list?promulgated=1&include=id&include=tags&include=promulgated&include=owner&include=supported-series';
  var parallelLimit = spec.config.parallelLimit || 5;

  //TODO more efficient check for changes: https://api.jujucharms.com/v5/changes/published?from=31-06-2015

  obj.discover = function(retrieve, log, progress, done) {
    debug('discovery initiated');

    //TODO get and process all bundles: https://jujucharms.com/q/?type=bundle

    request.get({
      url: apiList,
      json: true
    }, function(err, res, list) {
      if (handleRequest(err, res, done) === false) return;

      const charms = [];

      _.forEach(list.Results, (c) => {
        _.forEach(_.get(c, 'Meta["supported-series"].SupportedSeries'), (series) => {
            const charm = {
              name: c.Meta.id.Name,
              revision: c.Meta.id.Revision,
              series: series,
              owner: c.Meta.owner.User,
              tags: c.Meta.tags.Tags,
              apiUrl: apiBase + '/' + series + '/' + c.Meta.id.Name + '-' + c.Meta.id.Revision
            };

            charms.push(charm);
        });

      });

      getCharms(charms, retrieve, log, progress, done);
    });

    //TODO get and process all revisions of a certain charm
    /*request.get({
      url: apiBase + '/' + charm.name + '/expand-id',
      json: true
    }, function(err, res, revisions) {
      if (handleRequest(err, res, done) === false) return;

      getCharms(charms, retrieve, log, progress, done);
    });*/
  };



  // Retrieve given charms
  var getCharms = function(charms, retrieve, log, progress, callback) {
    var count = 0;
    var total = charms.length;

    async.eachLimit(charms, parallelLimit, function(charm, callback) {
      async.waterfall([
        function(callback) {
          request.get({
            url: charm.apiUrl + '/meta/any?' + apiMetaQuery,
            json: true
          }, function(err, res, details) {
            if (handleRequest(err, res, callback) === false) return;

            callback(null, details);
          });
        },
        function(details, callback) {
          request.get({
            url: charm.apiUrl + '/readme'
          }, function(err, res, readme) {
            if (err) return callback(err);

            if (res.statusCode === 200) details.readme = readme;

            callback(null, details);
          });
        },
        function(details, callback) {
          request.get({
            url: charm.apiUrl + '/archive/copyright'
          }, function(err, res, license) {
            if (err) return callback(err);

            if (res.statusCode === 200) details.license = license;

            callback(null, details);
          });
        },
        function(details, callback) {
          var rJobData = {
            properties: {
              name: charm.name + ' Juju charm',
              juju_charm_name: charm.name,
              revision: details.Id,
              latest: true,
              uris: [
                charmstoreBase + '/' + charm.name,
                charmstoreBase + '/' + charm.name + '/' + charm.series,
                charmstoreBase + '/' + charm.name + '/' + charm.series + '/' + charm.revision,
                apiBase + '/' + charm.name,
                apiBase + '/' + charm.series + '/' + charm.name,
                apiBase + '/' + charm.series + '/' + charm.name + '-' + charm.revision
              ],
              labels: [
                'Juju charm'
              ],
              info_url: charmstoreBase + '/' + charm.name,
              package_url: apiBase + '/' + charm.series + '/' + charm.name + '-' + charm.revision + '/archive',
              //repository_url: details.Meta['extra-info']['bzr-url'],
              //repository_type: 'bzr',
              created: details.Meta['archive-upload-time'].UploadTime, //details.charm.date_created,
              updated: details.Meta['archive-upload-time'].UploadTime, //details.Meta.extra-info.bzr-revisions[0].date,
              description: details.Meta['charm-metadata'].Summary + '\n\n' + details.Meta['charm-metadata'].Description,
              maintainer: { name: details.Meta.owner.User },
              downloads_count: details.Meta.stats.ArchiveDownload.total,
              //rating: details.charm.rating_denominator,
              //rating_count: details.charm.rating_numerator,
              //juju_charm_relations: details.charm.relations,
              //juju_charm_approved: details.charm.is_approved,
              juju_charm_subordinate: details.Meta['charm-metadata'].Subordinate,
              //juju_charm_id: details.charm.id,
              juju_charm_series: charm.series,
              juju_charm_owner: details.Meta.owner.User,
              //juju_charm_tested_with: details.charm.tested_providers,
              requires: [
                {
                  kind: 'host',
                  label: 'Infrastructure/Operating System/Linux/Ubuntu',
                  version: '= ' + charm.series
                }
              ]
            }
          };

          if (!_.isEmpty(details.Meta.tags.Tags))
            rJobData.properties.labels = rJobData.properties.labels.concat(details.Meta.tags.Tags);

          if (!_.isEmpty(details.Meta['charm-config'].Options)) {
            rJobData.properties.parameters = {};

            _.each(details.Meta['charm-config'].Options, function(opt, name) {
              rJobData.properties.parameters[name] = {
                type: opt.Type,
                description: opt.Description,
                default: opt.Default,
                mapping: 'charm_option'
              };
            });
          }

          _.each(details.Meta['charm-metadata'].Requires, function(req, name) {
            rJobData.properties.requires.push({
              kind: 'peer',
              uri: 'https://jujucharms.com/requires/' + req.Interface,
              self_resolve: true,
              juju_interface: req.Interface,
              juju_name: req.Name,
              juju_role: req.Role,
              juju_limit: req.Limit,
              juju_kind: req.kind
            });
          });

          if (!_.isEmpty(details.Meta['charm-metadata'].Provides))
            rJobData.properties.provides = [];

          _.each(details.Meta['charm-metadata'].Provides, function(req, name) {
            rJobData.properties.provides.push({
              kind: 'peer',
              uri: 'https://jujucharms.com/provides/' + req.Interface,
              juju_interface: req.Interface,
              juju_name: req.Name,
              juju_role: req.Role,
              juju_limit: req.Limit,
              juju_kind: req.kind
            });
          });

          if (!_.isEmpty(details.Meta['charm-metadata'].Peers))
            rJobData.properties.juju_peers = details.Meta['charm-metadata'].Peers;

          if (details.license)
            rJobData.properties.license = details.copyright || details.readme;

          if (details.readme) {
            rJobData.properties.readme = details.readme;
            rJobData.properties.readme_name = 'README.md';
          }

          //if (_.contains(details.charm.files, 'icon.svg')) rJobData.properties.icon_url = charm.apiUrl + '/file/icon.svg';

          retrieve(rJobData, callback);
        }
      ], function(err) {
        count++;
        debug('progress: ' + count + ' of ' + total);
        progress(count, total);

        callback(err);
      });
    }, function(err) {
      if (!err) log(total + ' Juju charms successfully discovered');

      callback(err);
    });
  };

  return obj;
};
