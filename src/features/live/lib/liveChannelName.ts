// EPG 别名匹配与同频道线路合并共用；`+` 有区分意义（CCTV5 与 CCTV5+），不能删掉。
export function normalizeLiveChannelName(value: string) {
  return value
    .toLowerCase()
    .replace(/[+＋]/g, 'plus')
    .replace(/[\[(（【].*?[\])）】]/g, '')
    .replace(/(4k|8k|1080p|720p|2160p|uhd|fhd|hd|sd)/gi, '')
    .replace(/(高清|超清|标清|频道|综合|蓝光)/g, '')
    .replace(/[^a-z0-9一-龥]/g, '');
}
