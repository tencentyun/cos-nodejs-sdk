
var libpath = './tencentyun_cos';

module.exports = {
  auth:     require(libpath + '/auth.js'),
  conf:     require(libpath + '/conf.js'),
  cos:      require(libpath + '/cos.js'),
};
