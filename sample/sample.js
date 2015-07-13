var tencentyun_cos = require('../');

tencentyun_cos.conf.setAppInfo('xxxxx', 'xxxxx', 'xxxxx');

tencentyun_cos.cos.delete('bucket01', '123/t.mp4');
tencentyun_cos.cos.upload('./test', 'bucket01', '123/t.mp4', '0666');
tencentyun_cos.cos.update('bucket01', '123/t.mp4', '');
tencentyun_cos.cos.stat('bucket01', '123/t.mp4');
tencentyun_cos.cos.listFiles('bucket01', '123/z');
tencentyun_cos.cos.createFolder('bucket01', '/123', function(ret) {console.log(ret);});
tencentyun_cos.cos.delete('bucket01', '123/');
tencentyun_cos.cos.upload_slice('./test', 'bucket01', '123/t.mp4', '0666', 512000);
