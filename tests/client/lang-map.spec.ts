/**
 * 扩展名 → 高亮语言映射测试：映射值必须被 highlighter 注册的 grammar 覆盖
 * （两者漂移即高亮失效——未知语言回落纯文本，渲染层不报错）。
 */
import { describe, expect, it } from 'vitest'
import { langOfPath } from '../../src/client/syntax/lang-map.ts'

describe('langOfPath', () => {
  it('maps common code extensions', () => {
    expect(langOfPath('src/main.ts')).toBe('typescript')
    expect(langOfPath('App.tsx')).toBe('typescript')
    expect(langOfPath('index.js')).toBe('typescript')
    expect(langOfPath('pkg.json')).toBe('json')
    expect(langOfPath('a.yaml')).toBe('yaml')
    expect(langOfPath('a.yml')).toBe('yaml')
    expect(langOfPath('doc.md')).toBe('markdown')
    expect(langOfPath('index.html')).toBe('xml') // 预算近似：html → xml
    expect(langOfPath('style.css')).toBe('css')
    expect(langOfPath('style.scss')).toBe('css') // 预算近似：scss → css
    expect(langOfPath('script.py')).toBe('python')
    expect(langOfPath('run.sh')).toBe('shellscript')
    expect(langOfPath('Main.java')).toBe('java')
    expect(langOfPath('main.go')).toBe('go')
    expect(langOfPath('lib.rs')).toBe('rust')
    expect(langOfPath('main.c')).toBe('c')
    expect(langOfPath('main.cpp')).toBe('c') // 预算近似：cpp → c
    expect(langOfPath('Program.cs')).toBe('csharp')
    expect(langOfPath('App.kt')).toBe('kotlin')
    expect(langOfPath('db.sql')).toBe('sql')
    expect(langOfPath('conf.toml')).toBe('toml')
    expect(langOfPath('app.ini')).toBe('ini')
  })

  it('maps extension-less well-known filenames (case-insensitive)', () => {
    expect(langOfPath('Dockerfile')).toBe('shellscript')
    expect(langOfPath('Makefile')).toBe('make')
  })

  it('returns undefined for unknown or budget-removed languages', () => {
    expect(langOfPath('README')).toBeUndefined()
    expect(langOfPath('data.bin')).toBeUndefined()
    expect(langOfPath('.gitignore')).toBeUndefined()
    expect(langOfPath('dir/')).toBeUndefined()
    expect(langOfPath('Gemfile')).toBeUndefined() // ruby 移除（依赖图过重）
    expect(langOfPath('app.rb')).toBeUndefined()
    expect(langOfPath('page.php')).toBeUndefined() // php 未注册
    expect(langOfPath('pkg.swift')).toBeUndefined()
  })

  it('handles windows separators and deep paths', () => {
    expect(langOfPath('C:\\src\\app\\main.ts')).toBe('typescript')
    expect(langOfPath('a/b/c/d.txt')).toBeUndefined()
  })
})
