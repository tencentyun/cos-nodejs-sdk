# tencentyun_cos-node
nodejs sdk for [腾讯云COS服务]

## 安装
npm install tencentyun_cos

## 指定您的配置
修改conf.js中的配置信息或者如下设置
```javascript
tencentyun_cos.conf.setAppInfo('000000', 'xxxxxxxx', 'xxxxxxx');
```

## 上传、查询、删除程序示例
```javascript
var tencentyun = require('./');

tencentyun.conf.setAppInfo('100000', 'AKIDoleG4e6U0j6EVQcjWXxzSO2Vv7Hqlgp2', 'ROlw3XYdNXNnII18ATs6zd7m5mivnApa');

tencentyun.cos.upload('/tmp/test.txt', 'bucket', 'text/1.txt', function(ret){

    // 查询
    tencentyun.cos.stat('bucket', 'text/1.txt', function(ret) {
        console.log(ret);
    });


    tencentyun.cos.delete('bucket', 'text/1.txt', function(ret) {
        console.log(ret);
    });
});

```
