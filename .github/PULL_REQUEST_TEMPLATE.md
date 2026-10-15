## 改动说明

<!-- 这条 PR 做了什么？为什么？关联的 Issue 是？ -->

## 改动类型

- [ ] Bug 修复（不破坏现有功能）
- [ ] 新功能（不破坏现有功能）
- [ ] 重构 / 性能优化（不改变行为）
- [ ] 破坏性改动（不向后兼容，需重大版本号升级）

## 自检清单（四门禁）

提交前请确认：

- [ ] `npm run check` 通过（tsc 0 错）
- [ ] `npm run test:ts` 通过（vitest 全绿，新增功能含单测）
- [ ] `npm run check:boundary` 通过（定位边界审计零侵蚀）
- [ ] `npm run build` 通过（vite build 成功）

## 其他自检

- [ ] 已新增/更新对应单测（`src/**/*.test.ts(x)`）
- [ ] i18n 三语（zh/en/ja）已同步（如新增用户可见文案）
- [ ] 已更新 CHANGELOG（如适用）
- [ ] 已更新 README（如新增功能或改动用户可见行为）

## 关联 Issue

<!-- 如 Closes #123 / Refs #456 -->
