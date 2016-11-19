var debug = require('debug')('gatherbase:discover:ubuntu');
var async = require('async');
var _ = require('lodash');
var request = require('request');
var cheerio = require('cheerio');



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



var generateUrl = function(metadataObj) {
  return 'https://cloud-images.ubuntu.com/locator/#' +
            encodeURIComponent(metadataObj.provider) + '-' +
            encodeURIComponent(metadataObj.region) + '-' +
            encodeURIComponent(metadataObj.version) + '-' +
            encodeURIComponent(metadataObj.arch) + '-' +
            encodeURIComponent(metadataObj.instanceType);
};

var generateMetadataObj = function(metadata) {
  var metadataObj = {
    provider: metadata[0],
    region: metadata[1],
    versionName: metadata[2],
    version: metadata[3],
    arch: metadata[4],
    instanceType: metadata[5],
    release: metadata[6],
    id: metadata[7]
  };

  metadataObj.url = generateUrl(metadataObj);

  if (metadata.length > 8) metadataObj.akiId = metadata[8];

  return metadataObj;
};



module.exports = function(spec) {
  debug('new instance of UbuntuDiscoverer', spec);

  var obj = {};

  spec = spec || {};
  spec.config = spec.config || {};

  obj.discover = function(retrieve, log, progress, done) {
    debug('discovery initiated');

    async.parallel({
      all: function(callback) {
        request.get({
          url: 'https://cloud-images.ubuntu.com/locator/releasesTable',
          json: true
        }, function(err, res, body) {
          if (handleRequest(err, res, callback) === false) return;

          body = body.replace('],\n]\n}', ']]}');
          body = JSON.parse(body);

          callback(null, body.aaData);
        });
      },
      ec2: function(callback) {
        request.get({
          url: 'https://cloud-images.ubuntu.com/locator/ec2/releasesTable',
          json: true
        }, function(err, res, body) {
          if (handleRequest(err, res, callback) === false) return;

          body = body.replace('],\n]\n}', ']]}');
          body = JSON.parse(body);

          _.each(body.aaData, function(metadata) {
            var region = metadata[0];

            if (_.startsWith(region, 'cn-')) metadata.unshift('Amazon AWS China');
            else if (_.startsWith(region, 'us-gov-')) metadata.unshift('Amazon GovCloud');
            else metadata.unshift('Amazon AWS');
          });

          callback(null, body.aaData);
        });
      }
    }, function(err, results) {
      if (err) return done(err);

      var list = results.all.concat(results.ec2);

      var total = list.length;
      var count = 0;

      // Determine latest revisions
      var latest = {};
      _.each(list, function(metadata) {
        var m = generateMetadataObj(metadata);

        var revision = parseFloat(m.release);

        if (!latest[m.url] || latest[m.url] < revision) latest[m.url] = revision;
      });

      // Trigger RETRIEVE jobs
      async.eachSeries(list, function(metadata, callback) {
        var m = generateMetadataObj(metadata);

        var $ = cheerio.load(m.id);

        m.id = $('a').text() || m.id;
        m.providerUrl = $('a').attr('href') || m.providerUrl;
        m.providerLabel = 'Provider/' + _.first(m.provider.split(' '));
        if (!_.isEmpty(_.tail(m.provider.split(' ')))) m.providerLabel += '/' + _.tail(m.provider.split(' ')).join(' ');

        var rJobData = {
          properties: {
            name: 'Ubuntu Cloud Image ' + m.version + ' (' + m.arch + ') on ' + m.provider + ' (' + m.region + ', ' + m.instanceType + ')',
            revision: m.release,
            uris: [
              m.url
            ],
            labels: [
              'Ubuntu Cloud Image',
              'Infrastructure/Operating System/Linux/Ubuntu',
              'Executable/Image/VM Image',
              'Virtualization/Hardware/Hypervisor'
            ],
            info_url: m.providerUrl || 'https://cloud-images.ubuntu.com/locator',
            maintainer: { name: 'Canonical Ltd.' },
            region: m.region,
            arch: m.arch,
            ubuntu_version: m.version,
            ubuntu_version_name: m.versionName,
            ubuntu_instance_type: m.instanceType,
            ubuntu_image_id: m.id,
            ubuntu_image_provider: _.kebabCase(m.provider.toLowerCase()),
            provides: [
              {
                label: 'Infrastructure/Operating System/Linux/Ubuntu',
                version: m.version
              }
            ],
            requires: [
              {
                kind: 'host',
                label: m.providerLabel
              }
            ]
          }
        };

        if (m.providerUrl) rJobData.properties.uris.push(m.providerUrl);

        if (latest[m.url] === parseFloat(m.release)) rJobData.properties.latest = true;

        if (_.startsWith(m.id, 'ami-')) {
          rJobData.properties.amazon_ami_id = m.id;

          rJobData.properties.labels.push('Executable/Image/VM Image/AMI');
        }

        if (m.akiId) rJobData.properties.amazon_aki_id = m.akiId;

        retrieve(rJobData, callback);

        count++;
        progress(count, total);
      }, function(err) {
        if (err) return done(err);

        log(total + ' Ubuntu images successfully discovered');

        done();
      });
    });
  };

  return obj;
};
