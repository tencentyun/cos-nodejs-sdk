//var qcloud_cos = require('qcloud_cos');
var qcloud_cos = require('../');

qcloud_cos.conf.setAppInfo('1000000', 'AKIiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii', 'wSDlllllllllllllllllllllllllllll');

qcloud_cos.cos.deleteFile('bucket01', '123/t.mp4', function(ret) {console.log(ret);
qcloud_cos.cos.upload('./test', 'bucket01', '123/t.mp4', '0666', function(ret) {console.log(ret);
qcloud_cos.cos.updateFile('bucket01', '123/t.mp4', '', function(ret) {console.log(ret);
qcloud_cos.cos.statFile('bucket01', '123/t.mp4', function(ret) {console.log(ret);
qcloud_cos.cos.prefixSearch('bucket01', '123', 'z', function(ret) {console.log(ret);
qcloud_cos.cos.createFolder('bucket01', '/123', function(ret) {console.log(ret);
qcloud_cos.cos.deleteFolder('bucket01', '123/', function(ret) {console.log(ret);
qcloud_cos.cos.upload_slice('./test', 'bucket01', '123/t.mp4', '0666', 512000);});});});});});});});
