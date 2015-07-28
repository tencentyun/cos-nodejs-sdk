var fs = require('fs');
var path = require('path');
var os = require('os');

// 请到app.qcloud.com查看您对应的appid相关信息并填充
exports.APPID = '您的APPID';
exports.SECRET_ID = '您的SECRET_ID';
exports.SECRET_KEY = '您的SECRET_KEY';

var pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../', 'package.json')));
var ua = function() {
    return 'Qcloud-Cos-Nodejs/' + pkg.version + ' (' + os.type() + '; ' + os.platform() + '; ' + os.arch() + '; ) ';
}

// 签名的有效时间
exports.EXPIRED_SECONDS = 60;

exports.recvTimeout = 30000;
exports.USER_AGENT = ua;
exports.API_COS_END_POINT = 'http://web.file.myqcloud.com/files/v1/';

// timeout单位秒
exports.setAppInfo = function(appid, secretId, secretKey, timeout) {
    module.exports.APPID = appid;
    module.exports.SECRET_ID = secretId;
    module.exports.SECRET_KEY = secretKey;
    module.exports.recvTimeout = timeout * 1000;
}
