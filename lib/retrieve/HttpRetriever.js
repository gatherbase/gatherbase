var fs = require('fs-extra');
var debug = require('debug')('gatherbase:retrieve:http');
var download = require('download');
var filenamify = require('filenamify');
var uuid = require('uuid');
var path = require('path');
var _ = require('lodash');



module.exports = function(spec) {
  debug('new instance of HttpRetriever', spec);

  var obj = {};

  obj.retrieve = function(urlObj, hJobData, log, progress, callback) {
    urlObj = urlObj || {};
    urlObj.strip = urlObj.strip || 1;
    if (!_.isBoolean(urlObj.extract)) urlObj.extract = true;

    var source = urlObj.url;
    var destination = hJobData.base;
    var subDir;

    //hJobData.config = {};

    const nameFromUrl = filenamify(path.basename(source));

    if (!urlObj.extract && urlObj.file_name && urlObj.file_name !== nameFromUrl) urlObj.move = true;
    else if (!urlObj.extract && !urlObj.file_name) urlObj.file_name = nameFromUrl;

    if (urlObj.extract) {
      subDir = uuid.v4();
      destination = path.join(destination, subDir);

      try {
        fs.mkdirsSync(destination);
      } catch (err) {
        return callback(err);
      }
    }

    download(source, destination, urlObj).then(() => {
      if (urlObj.file_name && !urlObj.extract) {
        hJobData.files.push({ url: urlObj.url, name: urlObj.file_name });

        log('file ' + urlObj.file_name + ' stored to ' + hJobData.base);
      } else {
        hJobData.dirs.push({ url: urlObj.url, name: subDir });

        log('dir ' + subDir + ' stored to ' + hJobData.base);
      }

      if (urlObj.move && !urlObj.extract) {
        fs.move(path.join(hJobData.base, nameFromUrl), path.join(hJobData.base, urlObj.file_name), (err) => {
          callback(err, hJobData);
        });
      } else {
        callback(null, hJobData);
      }
    }).catch(callback);
  };

  return obj;
};
