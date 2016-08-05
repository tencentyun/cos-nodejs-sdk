var http = require('http');
var https = require('https');
var urlM = require('url');
var fs = require('fs');
var crypto = require('crypto');
var formstream = require('formstream');
var auth = require('./auth');
var conf = require('./conf');

var COS_PARAMS_ERROR = -1;
var COS_NETWORK_ERROR = -2;
var COS_FOLDER_ERROR = -3;

//512K
var SLICE_SIZE_512K = 524288;
//1M
var SLICE_SIZE_1M = 1048576;
//2M
var SLICE_SIZE_2M = 2097152;
//3M
var SLICE_SIZE_3M = 3145728;
//20M 大于20M的文件需要进行分片传输
var MAX_UNSLICE_FILE_SIZE = 20971520;

function buildRequest(options, callback) {
	var net = http;
	if (options['protocol'] == "https:") {
		net = https;
	}
	var req = net.request(options,
		function (res) {
			var body = "";
			res.on('data', function (data) { body += data; })
			   .on('end', function () {
				try {
					var ret = JSON.parse(body.toString());
				} catch (err) {
					console.log(err)
				}
				if (ret) {
					var result = {
						'code':ret.code, 
						'message':ret.message || '', 
						'data':{}
					}

					if (0 == ret.code && ret.hasOwnProperty('data')) {
						result.data = ret.data;
					}

					callback(result);

				} else {
					callback({'code':COS_NETWORK_ERROR, 'message':'response '+body.toString()+' is not json', 'data':{}});
				}
			});
		}).on('error', function(e){
			callback({'code':COS_NETWORK_ERROR, 'message':String(e.message), 'data':{}});
		});
	req.setTimeout(conf.recvTimeout, function(){
		req.end();
		callback({'code':COS_NETWORK_ERROR, 'message':'recv timeout', 'data':{}});
	});
	return req;
}

/**
 * 上传本地文件
 * @param  {string}   filePath     文件本地路径，必须
 * @param  {string}   bucket       bucket名称，必须
 * @param  {string}   dstpath      文件存储的路径和名称，必须
 * @param  {string}   bizattr      文件的属性，可选
 * @param  {int}      insertOnly   是否允许覆盖文件，0表示允许，1表示不允许，可选
 * @param  {Function} callback     用户上传完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function upload(filePath, bucket, dstpath, bizattr, insertOnly, callback) {

	if (typeof bizattr === 'function') {
		callback = bizattr;
		bizattr = null;
	}else if(typeof insertOnly === 'function'){
		callback = insertOnly;
		insertOnly = undefined;
	} else {
		callback = callback || function(ret){ console.log(ret); };
	}

	var isExists = fs.existsSync(filePath);
	if (isExists && typeof callback === 'function') {


		var stats = fs.statSync(filePath);
		var fileSizeInBytes = stats["size"];
		if(fileSizeInBytes>=MAX_UNSLICE_FILE_SIZE){//大于20M用分片上传

			upload_slice(filePath, bucket, dstpath, bizattr, null, null, insertOnly, callback);
			return;
		}

		bucket = bucket.strip();
		dstpath  = fixPath(dstpath);
		var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
		var sign  = auth.signMore(bucket, expired);
		var url = generateResUrl(bucket, dstpath);
		var urlInfo = urlM.parse(url);

		var sha = crypto.createHash('sha1');

		var fsRS = fs.createReadStream(filePath);
		fsRS.on('data', function(d) { sha.update(d); });

		fsRS.on('end', function() {
				var form = formstream()
					.field('op', 'upload')
					.field('sha', sha.digest('hex'));


				form.file('filecontent', filePath, fileSizeInBytes);
				if (bizattr) {
					form.field('biz_attr', bizattr.toString());
				}
				if(insertOnly!==undefined){
					form.field('insertOnly', insertOnly);
				}

				var headers = form.headers();
				headers['Authorization'] = sign;
				headers['User-Agent'] = conf.USER_AGENT();

				var options = {
					protocol: urlInfo.protocol,
					hostname: urlInfo.hostname,
					port: urlInfo.port,
					path: urlInfo.path,
					method: 'POST',
					headers: headers
				};

				var req = buildRequest(options, callback);
				req && form.pipe(req);
		});

	} else {
		// error, file not exists
		callback({'code':COS_PARAMS_ERROR, 'message':'file '+filePath+' not exists or params error', 'data':{}});
	}
}

/**
 * 分片上传获取size
 * @param  {int}   size     文件分片大小,Bytes
 * return  {int}   size		文件分片大小,Bytes
 */
function getSliceSize(size){
	var res = SLICE_SIZE_1M;


	if(size<=SLICE_SIZE_512K){
		res = SLICE_SIZE_512K;
	}else if(size<=SLICE_SIZE_1M){
		res = SLICE_SIZE_1M;
	}else if(size<=SLICE_SIZE_2M){
		res = SLICE_SIZE_2M;
	}else if(size<=SLICE_SIZE_3M){
		res = SLICE_SIZE_3M;
	}else{
		res = SLICE_SIZE_3M;
	}


	return res;
}

/**
 * 分片上传本地文件
 * @param  {string}   filePath     文件本地路径，必须
 * @param  {string}   bucket       bucket目录名称，必须
 * @param  {string}   dstpath      文件存储的路径和名称，必须
 * @param  {string}   bizattr      目录/文件属性，业务端维护，可选
 * @param  {int}      slice_size   指定分片大小，小于3M，可选
 * @param  {string}   session      指定续传session，可选
 * @param  {int}      insertOnly   是否允许覆盖文件，0表示允许，1表示不允许，可选
 * @param  {Function} callback     用户上传完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function upload_slice(filePath, bucket, dstpath, bizattr, slice_size, session, insertOnly, callback) {

	bucket = bucket.strip();
	dstpath = fixPath(dstpath);
	slice_size = getSliceSize(slice_size);
	if (typeof bizattr === 'function') {
		callback = bizattr;
		bizattr = null;
	} else if (typeof slice_size === 'function') {
		callback = slice_size;
		slice_size = null;
	} else if (typeof session === 'function') {
		callback = session;
		session = null;
	} else if (typeof insertOnly === 'function') {
		callback = insertOnly;
		insertOnly = null;
	} else {
		callback = callback || function(ret){ console.log(ret); };
	}

	upload_prepare(filePath, bucket, dstpath, bizattr, slice_size, session, insertOnly, function (rsp){
		if (rsp['code'] != 0) {
			return callback(rsp);
		}
		/*秒传命中*/
		if (rsp.hasOwnProperty('data') && rsp['data'].hasOwnProperty('url')) {  
			return callback(rsp);
		}
		var offset = 0;
		var data = rsp['data'];
		if (data.hasOwnProperty('slice_size')) {
			slice_size = data['slice_size'];
		}
		if (data.hasOwnProperty('offset')) {
			offset = data['offset'];
		}
		if (data.hasOwnProperty('session')) {
			session = data['session'];
		}
		var stats = fs.statSync(filePath);
		var size = stats["size"];
		var retry = 0;
		var func_upload = function (cb) {
			if (size > offset) {
				var length = (offset+slice_size>size ? size-offset : slice_size);
				upload_data(bucket,dstpath,filePath,offset,length,session,insertOnly,function (ret){
						if (ret['code'] != 0) {
							if (retry < 3) {
								retry ++;
								return func_upload();
							}
							return callback(ret); 
						}
						if (ret.hasOwnProperty('data') && ret['data'].hasOwnProperty('url')) {
							return callback(ret);
						}
						offset += slice_size;
						retry = 0;
						func_upload();
					});
			}
		}
		func_upload();
	});
}

function upload_prepare(filePath, bucket, dstpath, bizattr, slice_size, session, insertOnly, callback) {
	var isExists = fs.existsSync(filePath);
	if (isExists && typeof callback === 'function') {
		var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
		var sign  = auth.signMore(bucket, expired);
		var url = generateResUrl(bucket, dstpath);
		var urlInfo = urlM.parse(url);

		var sha = crypto.createHash('sha1');
		var fsRS = fs.createReadStream(filePath);
		fsRS.on('data', function(d) { sha.update(d); });

		fsRS.on('end', function() {
				var form = formstream()
					.field('op', 'upload_slice')
					.field('sha', sha.digest('hex'));

				var stats = fs.statSync(filePath);
				var fileSizeInBytes = stats["size"];
				form.field('filesize', fileSizeInBytes.toString());

				if (bizattr) {
					form.field('biz_attr', bizattr.toString());
				}
				if (slice_size) {
					form.field('slice_size', slice_size.toString());
				}
				if (session) {
					form.field('session', session.toString());
				}
				if (insertOnly>=0) {
					form.field('insertOnly', insertOnly);
				}



				var headers = form.headers();
				headers['Authorization'] = sign;
				headers['User-Agent'] = conf.USER_AGENT();

				var options = {
					protocol: urlInfo.protocol,
					hostname: urlInfo.hostname,
	  				port: urlInfo.port,
	  				path: urlInfo.path,
	  				method: 'POST',
	  				headers: headers
				};

				var req = buildRequest(options, callback);
				req && form.pipe(req);
		});
	} else {
		// error, file not exists
		callback({'code':COS_PARAMS_ERROR, 'message':'file '+filePath+' not exists or params error', 'data':{}});
	}
}


function upload_data(bucket, dstpath, filePath, offset, length, session, insertOnly, callback) {
	var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
	var sign  = auth.signMore(bucket, expired);
	var url = generateResUrl(bucket, dstpath);
	var urlInfo = urlM.parse(url);
	var form = formstream()
		.field('op', 'upload_slice')
		.field('session', session.toString())
		.field('offset', offset.toString());
	if(insertOnly>=0){
		form.field('insertOnly',insertOnly);
	}
	var fstream = fs.createReadStream(filePath, {start:offset, end:offset+length-1});
	form.stream('filecontent', fstream, filePath, length);

	var headers = form.headers();
	headers['Authorization'] = sign;
	headers['User-Agent'] = conf.USER_AGENT();

	var options = {
		protocol: urlInfo.protocol,
		hostname: urlInfo.hostname,
		port: urlInfo.port,
		path: urlInfo.path,
		method: 'POST',
		headers: headers
	};

	var req = buildRequest(options, callback);
	req && form.pipe(req);
}

/**
 * 处理路径参数
 * @param 	{string}   path        目录路径，必选参数
 * @param 	{string}   type        路径类型，可选参数，默认值为'file',如果是目录需要设置为'folder'
 * return	{string}   path        返回处理后的路径
 */
function fixPath(path, type){
	if(!path){
		return;
	}
	if(type=='folder'){
		path = encodeURIComponent(path.strip() + '/').replace(/%2F/g,'/');
	}else{
		path = encodeURIComponent(path.strip()).replace(/%2F/g,'/');
	}
	return path;
}

/**
 * 处理文件夹路径
 * @param 	{string}   path        目录路径，必选参数,不可以包含例如： '?' , '*' , ':' , '|' , '\' , '<' , '>' , '"'
 * return	{boolean}  res        返回处理后的结果,true表示OK false表示路径不合法
 */
function checkFolderName(path){
	var regForbidden = /[?*:|\\\\<>"]/;

	if(regForbidden.test(path)) {
		return false;
	}else{
		return true;
	}
}

/**
 * 创建目录
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录路径，必须以'/'结尾，必选参数
 * @param  {string}   bizattr      目录属性，业务端维护，可选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function createFolder(bucket, path, bizattr, callback) {

	if (typeof bizattr === 'function') {
		callback = bizattr;
		bizattr = null;
	}
	bizattr = bizattr || '';
	callback = callback || function(ret){console.log(ret)};

	if (typeof callback === 'function') {
		bucket = bucket.strip();
		path = fixPath(path,'folder');
		if(!checkFolderName(path)){
			callback({'code':COS_FOLDER_ERROR, 'message':'folder name error', 'data':{}});
			return;
		}
		var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
		var sign  = auth.signMore(bucket, expired);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var data = JSON.stringify({'op':'create','biz_attr':bizattr.toString()});

		var headers = {};
		headers['Authorization'] = sign;
		headers['Content-Type'] = 'application/json';
		headers['Content-Length'] = data.length;
		headers['User-Agent'] = conf.USER_AGENT();

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path,
			method: 'POST',
			headers: headers
		};

		var req = buildRequest(options, callback);
		req && req.end(data);
	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}


/**
 * 目录列表
 * @param  {string}   bucket		bucket名称，必选参数
 * @param  {string}   path			目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {int}      num          拉取的总数，可选参数，默认20
 * @param  {string}   pattern      可选参数，可选值为eListBoth, ListDirOnly, eListFileOnly 默认eListBoth
 * @param  {int}      order        可选参数，默认正序(=0), 填1为反序，需要翻页时，正序时0代表下一页，1代表上一页。反续时1代表下一页，0代表上一页。
 * @param  {string}   context      透传字段,用于翻页,前端不需理解,需要往前/往后翻页则透传回来
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function list(bucket, path, num, pattern, order, context, callback) {
	bucket = bucket.strip();
	path = fixPath(path,'folder');
	listFiles(bucket, path, num, pattern, order, context, callback);
}


/**
 * 目录列表,前缀搜索
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path			目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {int}      num          拉取的总数，可选参数，默认20
 * @param  {string}   pattern      可选参数，可选值为eListBoth, ListDirOnly, eListFileOnly 默认eListBoth
 * @param  {int}      order        可选参数，默认正序(=0), 填1为反序，需要翻页时，正序时0代表下一页，1代表上一页。反续时1代表下一页，0代表上一页。
 * @param  {string}   context      透传字段,用于翻页,前端不需理解,需要往前/往后翻页则透传回来
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function listFiles(bucket, path, num, pattern, order, context, callback) {
	if (typeof num === 'function') {
		callback = num;
		num = null;
	} else if (typeof pattern === 'function') {
		callback = pattern;
		pattern = null;
	} else if (typeof order === 'function') {
		callback = order;
		order = null;
	} else if (typeof context === 'function') {
		callback = context;
		context = null;
	}
	num = num || 20;
	pattern = pattern || 'eListBoth';
	order = order || 0;
	context = encodeURIComponent(context || '');
	callback = callback || function(ret){console.log(ret)};

	if (typeof callback === 'function') {
		var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
		var sign  = auth.signMore(bucket, expired);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var headers = {};
		headers['Authorization'] = sign;
		headers['User-Agent'] = conf.USER_AGENT();

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path+'?op=list&num='+num+'&pattern='+pattern+'&order='+order+'&context='+context,
			method: 'GET',
			headers: headers
		};

		var req = buildRequest(options, callback);

		req && req.end();

	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}

/**
 * 更新目录
 * @param  {string}   bucket		bucket名称，必选参数
 * @param  {string}   path			目录路径，必须以'/'结尾，必选参数
 * @param  {string}   bizattr		目录属性，业务端维护，可选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function updateFolder(bucket, path, bizattr, callback) {
	bucket = bucket.strip();
	path = fixPath(path,'folder');
	update(bucket, path, bizattr, callback);
}


/**
 * 更新
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function update(bucket, path, bizattr, callback) {

	bizattr = bizattr || '';
	callback = callback || function(ret){console.log(ret)};

	if (typeof callback === 'function') {
		var sign  = auth.signOnce(bucket, '/'+conf.APPID+'/'+bucket+'/'+path);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var data = {"op":"update"};

		var flag = 0;

		if(bizattr){
			data['biz_attr'] = bizattr;
			flag = flag | 0x01;
		}

		if(flag!=0 && flag!=1){
			data['flag'] = flag;
		}

		data = JSON.stringify(data);


		var headers = {};
		headers['Authorization'] = sign;
		headers['Content-Type'] = 'application/json';
		headers['User-Agent'] = conf.USER_AGENT();
		headers['Content-Length'] = data.length;

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path,
			method: 'POST',
			headers: headers
		};

		var req = buildRequest(options, callback);

		req && req.end(data);


	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}


/**
 * 查询目录
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录路径，必须以'/'结尾，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function statFolder(bucket, path, callback) {
	bucket = bucket.strip();
	path = fixPath(path, 'folder');
	stat(bucket, path, callback);
}

/**
 * 查询文件或目录属性
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function stat(bucket, path, callback) {
	callback = callback || function(ret){console.log(ret)};

	if (typeof callback === 'function') {
		var expired = parseInt(Date.now() / 1000) + conf.EXPIRED_SECONDS;
		var sign  = auth.signMore(bucket, expired);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var headers = {};
		headers['Authorization'] = sign;
		headers['User-Agent'] = conf.USER_AGENT();

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path+'?op=stat',
			method: 'GET',
			headers: headers
		};

		var req = buildRequest(options, callback);
		req && req.end();

	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}


/**
 * 删除目录
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录路径，必须以'/'结尾，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function deleteFolder(bucket, path, callback) {
	bucket = bucket.strip();
	path = fixPath(path,'folder');
	del(bucket, path, callback);
}


/**
 * 删除文件/目录
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function del(bucket, path, callback) {

	callback = callback || function(ret){console.log(ret)};

	if (path == '' || path == '/' || typeof callback === 'function') {
		var sign  = auth.signOnce(bucket, '/'+conf.APPID+'/'+bucket+'/'+path);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var data = '{"op":"delete"}';

		var headers = {};
		headers['Authorization'] = sign;
		headers['Content-Type'] = 'application/json';
		headers['User-Agent'] = conf.USER_AGENT();
		headers['Content-Length'] = data.length;


		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path,
			method: 'POST',
			headers: headers
		};

		var req = buildRequest(options, callback);
		req && req.end(data);

	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}


/**
 * 查询文件
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         文件路径，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function statFile(bucket, path, callback) {
	bucket = bucket.strip();
	path = fixPath(path);
	stat(bucket, path, callback);
}


/**
 * 删除文件
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path         文件路径，必选参数
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function deleteFile(bucket, path, callback) {
	bucket = bucket.strip();
	path = fixPath(path);
	del(bucket, path, callback);
}



/**
 * 更新文件
 * @param  {string}   bucket     	 	 bucket名称，必选参数
 * @param  {string}   path        		 文件路径，必选参数
 * @param  {string}   bizattr			目录属性，业务端维护，可选参数
 * @param  {string}   authority			权限类型，可选参数，可选值为eInvalid,eWRPrivate,eWPrivateRPublic
 *										文件可以与bucket拥有不同的权限类型，已经设置过权限的文件如果想要撤销，直接赋值为eInvalid，则会采用bucket的权限
 * @param  {Array}   custom_headers		自定义header，可选参数
 * @param  {Function} callback     		完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 		入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function updateFile(bucket, path, bizattr, authority, custom_headers, callback) {
	bucket = bucket.strip();
	path = fixPath(path);
	if (typeof bizattr === 'function') {
		callback = bizattr;
		bizattr = null;
	} else if (typeof authority === 'function') {
		callback = authority;
		authority = null;
	} else if (typeof custom_headers === 'function') {
		callback = custom_headers;
		custom_headers = null;
	} else {
		callback = callback || function(ret){ console.log(ret); };
	}

	if (typeof callback === 'function') {
		var sign  = auth.signOnce(bucket, '/'+conf.APPID+'/'+bucket+'/'+path);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var data = {'op':'update'};

		var flag = 0;

		if(bizattr){
			data['biz_attr'] = bizattr;
			flag = flag | 0x01;
		}

		if(authority){
			data['authority'] = authority;
			flag = flag | 0x80;
		}

		if(custom_headers){

			custom_headers = JSON.stringify(custom_headers);
			data['custom_headers'] = custom_headers;
			flag = flag | 0x40;
		}

		if(flag!=0 && flag!=1){
			data['flag'] = flag;
		}

		data = JSON.stringify(data);

		var headers = {};
		headers['Authorization'] = sign;
		headers['Content-Type'] = 'application/json';
		headers['User-Agent'] = conf.USER_AGENT();
		headers['Content-Length'] = data.length;

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path,
			method: 'POST',
			headers: headers
		};

		var req = buildRequest(options, callback);
		req && req.end(data);

	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}


/**
 * 移动文件
 * @param  {string}   bucket     	 	 bucket名称，必选参数
 * @param  {string}   path        		 文件路径，必选参数
 * @param  {string}   destPath			目标路径,默认是当前路径，比如当前path是/123/a.txt,destPath填了456/a.txt则最终会生成/123/456.txt，必选参数
 * @param  {string}   overWrite			是否覆盖重名文件 0表示不覆盖 1表示覆盖 可选参数
 * @param  {Function} callback     		完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 		入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function moveFile(bucket, path, destPath, overWrite, callback) {
	bucket = bucket.strip();
	path = fixPath(path);

	callback = callback || function(ret){ console.log(ret); };

	if (typeof callback === 'function') {
		var sign  = auth.signOnce(bucket, '/'+conf.APPID+'/'+bucket+'/'+path);
		var url = generateResUrl(bucket, path);
		var urlInfo = urlM.parse(url);

		var data = {'op':'move'};

		data['dest_fileid'] = destPath;

		if(overWrite>=0){
			data['to_over_write'] = overWrite;
		}

		data = JSON.stringify(data);

		var headers = {};
		headers['Authorization'] = sign;
		headers['Content-Type'] = 'application/json';
		headers['User-Agent'] = conf.USER_AGENT();
		headers['Content-Length'] = data.length;

		var options = {
			protocol: urlInfo.protocol,
			hostname: urlInfo.hostname,
			port: urlInfo.port,
			path: urlInfo.path,
			method: 'POST',
			headers: headers
		};

		var req = buildRequest(options, callback);
		req && req.end(data);

	} else {
		// error
		callback({'code':COS_PARAMS_ERROR, 'message':'params error', 'data':{}});
	}
}




/**
 * 前缀搜索
 * @param  {string}   bucket       bucket名称，必选参数
 * @param  {string}   path			目录/文件路径，目录必须以'/'结尾，文件不能以'/'结尾，必选参数
 * @param  {string}   prefix       列出含prefix此前缀的所有文件
 * @param  {int}      num          拉取的总数
 * @param  {string}   pattern      可选参数，可选值为eListBoth, ListDirOnly, eListFileOnly 默认eListBoth
 * @param  {int}      order        默认正序(=0), 填1为反序，需要翻页时，正序时0代表下一页，1代表上一页。反续时1代表下一页，0代表上一页。
 * @param  {string}   context      透传字段,用于翻页,前端不需理解,需要往前/往后翻页则透传回来
 * @param  {Function} callback     完毕后执行的回调函数，可选，默认输出日志 格式为 function (ret) {}
 *                                 入参为ret：{'code':0,'message':'ok','data':{...}}
 */
function prefixSearch(bucket, path, prefix, num, pattern, order, context, callback) {
	bucket = bucket.strip();
	path = fixPath(path);
	if (path == '') {
		path = prefix;
	} else {
		path += '/'+prefix;
	}

	listFiles(bucket, path, num, pattern, order, context, callback);
}



function generateResUrl(bucket, path) {
	return conf.API_COS_END_POINT+conf.APPID+'/'+bucket+'/'+(path=='/'?"":path);
}

String.prototype.strip = function(){
	return this.replace(/(^\/*)|(\/*$)/g, '');
}
String.prototype.lstrip = function(){
	return this.replace(/(^\/*)/g, '');
}
String.prototype.rstrip = function(){
	return this.replace(/(\/*$)/g, '');
}

exports.upload = upload;
exports.upload_slice = upload_slice;
exports.statFile = statFile;
exports.statFolder = statFolder;
exports.deleteFile = deleteFile;
exports.deleteFolder = deleteFolder;
exports.updateFile = updateFile;
exports.updateFolder = updateFolder;
exports.list = list;
exports.prefixSearch = prefixSearch;
exports.createFolder = createFolder;
exports.moveFile = moveFile;
