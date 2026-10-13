/**
 * 鸿蒙包名 → 中文名。手机上的应用名是资源引用（$string:app_name），电脑端经 hdc 解析不出来，
 * 只能内置对照表；没收录的显示包名。新装应用想显示中文名就往这里加一行。
 */
const LABELS: Record<string, string> = {
  'yylx.danmaku.bili': '哔哩哔哩',
  'com.tencent.tmgp.sgame.hw': '王者荣耀',
  'com.tencent.jkchess.huawei': '金铲铲之战',
  'com.tencent.tmgp.osgame.huawei': '英雄联盟手游',
  'com.tencent.smobagamehelper': '王者营地',
  'com.tencent.wechat': '微信',
  'com.tencent.mqq': 'QQ',
  'com.tencent.hm.qqmusic': 'QQ音乐',
  'com.tencent.weread.hmos': '微信读书',
  'com.tencent.meeting.app': '腾讯会议',
  'com.tencent.qqmail.hmos': 'QQ邮箱',
  'com.tencent.imahm': 'ima',
  'com.ss.hm.ugc.aweme': '抖音',
  'com.ss.feishu': '飞书',
  'com.xingin.xhs_hos': '小红书',
  'com.larus.nova.hm': '豆包',
  'com.aliyun.tongyi4ohos': '通义',
  'com.quark.ohosbrowser': '夸克',
  'com.dingtalk.hmos': '钉钉',
  'com.alipay.mobile.client': '支付宝',
  'com.taobao.taobao4hmos': '淘宝',
  'com.taobao.idlefish4ohos': '闲鱼',
  'com.jd.hm.mall': '京东',
  'com.vip.hosapp': '唯品会',
  'com.alibaba.wireless_hmos': '阿里巴巴',
  'com.sankuai.hmeituan': '美团',
  'com.sankuai.dianping': '大众点评',
  'me.ele.eleme': '饿了么',
  'com.wudaokou.hippo_hmos': '盒马',
  'cn.samsclub.hm.app': '山姆会员商店',
  'cn.gov.tax.its.hm': '个人所得税',
  'com.amap.hmapp': '高德地图',
  'com.sdu.didi.hmos.psnger': '滴滴出行',
  'com.hellobike.app': '哈啰',
  'com.ctrip.harmonynext': '携程旅行',
  'com.qunar.hos': '去哪儿旅行',
  'com.chinarailway.ticketingHM': '铁路12306',
  'com.umetrip.hm.app': '航旅纵横',
  'com.baidu.netdisk.hmos': '百度网盘',
  'cn.wps.mobileoffice.hap': 'WPS Office',
  'com.edrawsoft.mindmaster.h': 'MindMaster',
  'cn.ticktick.task.hm': '滴答清单',
  'com.eusoft.ting.en.hm': '每日英语听力',
  'com.binfenyingyu.yinbiao': '缤纷英语音标',
  'com.Csai.pmp': 'PMP',
  'com.gotokeep.hm.keep': 'Keep',
  'com.changba.ktv': '唱吧',
  'com.lemon.hm.lv': '剪映',
  'com.meitu.beautycam': '美颜相机',
  'cn.yuewen.ywohapp': '起点读书',
  'com.bzl.bosszhipin': 'BOSS直聘',
  'com.liepin.mishu.hm': '猎聘',
  'com.zhilian.zhaopin': '智联招聘',
  'com.job.hm51job': '前程无忧',
  'com.taou.oh_neitui': '脉脉',
  'com.hexin.hmn.sjcg': '同花顺',
  'com.cmbchina.harmony': '招商银行',
  'com.ccb.mobilebank.hm': '建设银行',
  'com.boc.bocsoft.mbs.personal': '中国银行',
  'com.bankcomm.mobshos': '交通银行',
  'com.unionpay.hmos.wallet': '云闪付',
  'com.chinamobile.cmcc': '中国移动',
  'com.ct.client.hm': '中国电信',
  'com.huawei.hmos.browser': '华为浏览器',
  'com.huawei.hmos.photos': '图库',
  'com.huawei.hmos.camera': '相机',
  'com.huawei.hmos.himovie': '华为视频',
  'com.huawei.hmsapp.music': '华为音乐',
  'com.huawei.hmos.notepad': '备忘录',
  'com.huawei.hmos.email': '邮件',
  'com.huawei.hmsapp.books': '华为阅读',
  'com.huawei.hmsapp.appgallery': '应用市场',
};

export function appLabel(bundle: string): string {
  return LABELS[bundle] ?? bundle;
}

/**
 * 系统组件：不进「关联应用」候选（桌面、锁屏、开机向导、紧急呼叫这类会算出假时长）。
 * 华为自家常用应用（浏览器、图库…）在对照表里有名字的保留。
 */
export function isSystemBundle(bundle: string): boolean {
  if (LABELS[bundle]) return false;
  return /^(com\.(huawei|ohos)\.|ohos\.|com\.atomicservice\.)/.test(bundle);
}
