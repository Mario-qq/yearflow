import { describe, expect, it } from 'vitest';
import { dateWord, parseQuickAdd } from './parseQuickAdd';

/* 今天 = 2026-10-16 周五；本周一 10-12，下周一 10-19 */
const ctx = { today: '2026-10-16', goals: [{ id: 'g-sap', name: 'SAP系统' }, { id: 'g-ai', name: 'AI 学习' }] };
const p = (s: string) => parseQuickAdd(s, ctx);

describe('日期词', () => {
  it('相对日 / 周几（已过 ⇒ 下周）/ 下周 / 下下周', () => {
    expect(dateWord('明天', ctx.today)).toBe('2026-10-17');
    expect(dateWord('大后天', ctx.today)).toBe('2026-10-19');
    expect(dateWord('周三', ctx.today)).toBe('2026-10-21');
    expect(dateWord('周六', ctx.today)).toBe('2026-10-17');
    expect(dateWord('周五', ctx.today)).toBe('2026-10-16');
    expect(dateWord('下周一', ctx.today)).toBe('2026-10-19');
    expect(dateWord('下周日', ctx.today)).toBe('2026-10-25');
    expect(dateWord('下下周二', ctx.today)).toBe('2026-10-27');
  });
  it('M.D / M月D日：早于 30 天前算明年；非法日期为 null', () => {
    expect(dateWord('10.20', ctx.today)).toBe('2026-10-20');
    expect(dateWord('10月31日', ctx.today)).toBe('2026-10-31');
    expect(dateWord('1.5', ctx.today)).toBe('2027-01-05');
    expect(dateWord('9.20', ctx.today)).toBe('2026-09-20');
    expect(dateWord('2.30', ctx.today)).toBeNull();
  });
});

describe('一句话新建', () => {
  it('什么都不写 = 今天的普通工作待办', () => {
    expect(p('审 cpmi310 客制改动的代码')).toEqual({
      kind: 'todo',
      title: '审 cpmi310 客制改动的代码',
      urgency: 'normal',
      scope: 'work',
      date: '2026-10-16',
    });
  });

  it('!! 紧急、! 尽快（全角也认）', () => {
    expect(p('!! 修出货单过帐 今天')).toMatchObject({ urgency: 'urgent', title: '修出货单过帐', date: '2026-10-16' });
    expect(p('！写需求文档 下周一')).toMatchObject({ urgency: 'soon', title: '写需求文档', date: '2026-10-19' });
  });

  it('周末的日子默认算生活；~ 可以显式指定', () => {
    expect(p('周六 洗车')).toMatchObject({ date: '2026-10-17', scope: 'life' });
    expect(p('下周二 体检 ~生活')).toMatchObject({ date: '2026-10-20', scope: 'life', title: '体检' });
    expect(p('周日 上线 ~工作')).toMatchObject({ scope: 'work' });
  });

  it('@人 变跟进：下发类动词 ⇒ 待下发，其余 ⇒ 待告知，动词从标题去掉', () => {
    expect(p('@李工 下发 ARM 测试脚本 下周二')).toMatchObject({
      kind: 'followup',
      person: '李工',
      mode: 'dispatch',
      title: 'ARM 测试脚本',
      date: '2026-10-20',
    });
    expect(p('@王芳 告知 apmt540 已修复')).toMatchObject({ mode: 'inform', title: 'apmt540 已修复' });
    expect(p('apmt540 已修复 @王芳')).toMatchObject({ mode: 'inform', person: '王芳' });
  });

  it('截止日与排期日分开', () => {
    expect(p('截止周五 写需求文档')).toMatchObject({ dueDate: '2026-10-16', date: '2026-10-16', title: '写需求文档' });
    expect(p('Informix 升级方案 ddl 10.31 下周三')).toMatchObject({ dueDate: '2026-10-31', date: '2026-10-21' });
  });

  it('句首/句尾的日期词可以不加空格；句中的不吃', () => {
    expect(p('明天修复出货单')).toMatchObject({ date: '2026-10-17', title: '修复出货单' });
    expect(p('修复出货单明天')).toMatchObject({ date: '2026-10-17', title: '修复出货单' });
    expect(p('整理今天的报表格式')).toMatchObject({ date: '2026-10-16', title: '整理今天的报表格式' });
  });

  it('标题里更早出现同一个日期词时，按命中位置切', () => {
    expect(p('周三的周报 周四')).toMatchObject({ title: '周三的周报', date: '2026-10-22' });
  });

  it('#目标：全名 / 前缀 / 包含，不区分大小写；匹配不上给出提示词', () => {
    expect(p('#sap 准备练习数据')).toMatchObject({ goalId: 'g-sap', title: '准备练习数据' });
    expect(p('#学习 看论文')).toMatchObject({ goalId: 'g-ai' });
    expect(p('#英语 背单词')).toMatchObject({ unknownGoal: '英语', title: '背单词' });
  });

  it('写「待处理」= 不排日子', () => {
    expect(p('待处理 研究统计信息自动更新')).toMatchObject({ date: null, title: '研究统计信息自动更新' });
  });

  it('例行：每天 / 工作日 / 每周几 / 每月几号 / 月末 / 第 N 个周几 / 最后一个周几', () => {
    expect(p('工作日 检查 MRP 夜间批次')).toMatchObject({ kind: 'routine', rule: { type: 'workday' }, title: '检查 MRP 夜间批次', date: null });
    expect(p('每周一三 提交周报')).toMatchObject({ rule: { type: 'weekly', daysOfWeek: [1, 3] }, ruleLabel: '每周一三' });
    expect(p('每周日 规划下周 ~生活')).toMatchObject({ rule: { type: 'weekly', daysOfWeek: [0] }, scope: 'life' });
    expect(p('每月5号 对账')).toMatchObject({ rule: { type: 'monthlyDay', monthDay: 5 } });
    expect(p('每月最后一天 月结支持')).toMatchObject({ rule: { type: 'monthlyDay', monthDay: -1 } });
    expect(p('每月第二个周三 部门例会')).toMatchObject({ rule: { type: 'monthlyNth', nth: 2, weekday: 3 } });
    expect(p('每月最后一个周五 聚餐')).toMatchObject({ rule: { type: 'monthlyNth', nth: -1, weekday: 5 } });
    expect(p('每天 背单词')).toMatchObject({ rule: { type: 'daily' } });
  });

  it('例行可带时间点；待办里的「3点」原样留在标题', () => {
    expect(p('每周一 9:00 提交周报')).toMatchObject({ kind: 'routine', time: '09:00', title: '提交周报' });
    expect(p('工作日 9点半 看 MRP 批次')).toMatchObject({ time: '09:30', title: '看 MRP 批次' });
    expect(p('每月5号 14点30 对账')).toMatchObject({ time: '14:30', title: '对账' });
    expect(p('每天 25:00 乱写')).toMatchObject({ kind: 'routine', title: '25:00 乱写' });
    expect(p('明天 3点 开会')).toMatchObject({ kind: 'todo', title: '3点 开会' });
    expect(p('明天 3点 开会').time).toBeUndefined();
  });

  it('规则词夹在正文里不算例行', () => {
    expect(p('统计工作日加班')).toMatchObject({ kind: 'todo', title: '统计工作日加班' });
    expect(p('整理每天的巡检记录')).toMatchObject({ kind: 'todo' });
  });
});
