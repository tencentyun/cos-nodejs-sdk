# qcloud_cos-node
nodejs sdk for [腾讯云COS服务]

## 安装
npm install qcloud_cos

## 指定您的配置
修改conf.js中的配置信息或者如下设置
```javascript
qcloud_cos.conf.setAppInfo('000000', 'xxxxxxxx', 'xxxxxxx');
```

## 程序示例
```javascript
var qcloud = require('qcloud_cos');

qcloud.conf.setAppInfo('100000', 'AKIDoooooooooooooooooooooooooooooooo', 'ROllllllllllllllllllllllllllllll');

/*
* 各接口的callback 为单个参数的function： function(ret){}
* ret 为 {'code':0,'message':'ok','data':{}} 的对象，其中data的内容依接口有所不同
*/
//上传文件
qcloud.cos.upload('/tmp/test.txt', 'bucket', 'text/1.txt','new myattr',1, function(ret){
    if (ret.code != 0) {
        console.log(ret);
    }else{
        // 查询文件
        qcloud.cos.statFile('bucket', 'text/1.txt', function(ret) {
            console.log(ret);
        });
        // 删除文件
        qcloud.cos.deleteFile('bucket', 'text/1.txt', function(ret) {
            console.log(ret);
        });
    }
});

//创建目录
qcloud.cos.createFolder('bucket', '/firstDir/');

//获取指定目录下文件列表
qcloud.cos.list('bucket', '/firstDir/', 20, 'eListFileOnly');

//获取bucket下文件列表
qcloud.cos.list('bucket', '/', 20, 'eListFileOnly');

//获取指定目录下以'abc'开头的文件
qcloud.cos.prefixSearch('bucket', '/firstDir/', 'abc', 20, 'eListFileOnly');

//设置文件权限以及自定义header
var headers = {
        "Cache-Control": "no-cache",
        "Content-Type" : "application/json",
        "Content-Encoding" : "utf-8"
    };
    
qcloud_cos.cos.updateFile('0001', '123/test_slice.dat', 'newattr', 'eWRPrivate', headers, function(ret) {console.log(ret)});

```

