var crypto = require('crypto');
var urlM = require('url');
var conf = require('./conf');

exports.AUTH_URL_FORMAT_ERROR = -1;
exports.AUTH_SECRET_ID_KEY_ERROR = -2;

exports.signMore = function(bucket, expired) {
	return appSign(bucket, '', expired);
}
exports.signOnce = function(bucket, fileid) {
	return appSign(bucket, fileid, 0);
}

function appSign(bucket, fileid, expired) {

    var now            = parseInt(Date.now() / 1000);
    var rdm            = parseInt(Math.random() * Math.pow(2, 32));

    var secretId = conf.SECRET_ID, secretKey = conf.SECRET_KEY;

    if (!secretId.length || !secretKey.length){
        return AUTH_SECRET_ID_KEY_ERROR;
    }

    var plainText = 'a='+conf.APPID+'&k='+secretId+'&e='+expired+'&t='+now+'&r='+rdm+'&f='+fileid+'&b='+bucket;
    
    var data = new Buffer(plainText,'utf8');
    
    var res = crypto.createHmac('sha1',secretKey).update(data).digest();
    
    var bin = Buffer.concat([res,data]);
    
    var sign = bin.toString('base64');

    return sign;
}
