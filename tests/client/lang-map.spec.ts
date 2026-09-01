/**
 * 扩展名 → 高亮语言映射测试：映射值必须被 highlighter 注册的 grammar 覆盖
 * （两者漂移即高亮失效——未知语言回落纯文本，渲染层不报错）。
 */
import { describe, expect, it } from 'vitest'
import { langOfPath } from '../../src/client/syntax/lang-map.ts'

describe('langOfPath', () => {
  it('maps common code extensions', () => {
    expect(langOfPath('src/main.ts')).toBe('typescript')
    expect(langOfPath('App.tsx')).toBe('tsx')
    expect(langOfPath('index.js')).toBe('javascript')
    expect(langOfPath('App.jsx')).toBe('jsx')
    expect(langOfPath('pkg.json')).toBe('json')
    expect(langOfPath('a.yaml')).toBe('yaml')
    expect(langOfPath('a.yml')).toBe('yaml')
    expect(langOfPath('doc.md')).toBe('markdown')
    expect(langOfPath('index.html')).toBe('html') // 真实 html grammar（内嵌 script/style）
    expect(langOfPath('style.css')).toBe('css')
    expect(langOfPath('style.scss')).toBe('scss') // scss 独立 grammar
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

  it('maps frontend template and component extensions', () => {
    expect(langOfPath('App.vue')).toBe('vue')
    expect(langOfPath('App.svelte')).toBe('svelte')
    expect(langOfPath('App.astro')).toBe('astro')
    expect(langOfPath('page.php')).toBe('php')
    expect(langOfPath('welcome.blade.php')).toBe('blade') // 双段扩展名优先
    expect(langOfPath('page.htm')).toBe('html')
  })

  it('maps extended engineering languages', () => {
    expect(langOfPath('main.swift')).toBe('swift')
    expect(langOfPath('game.lua')).toBe('lua')
    expect(langOfPath('main.dart')).toBe('dart')
    expect(langOfPath('query.graphql')).toBe('graphql')
    expect(langOfPath('query.gql')).toBe('graphql')
    expect(langOfPath('schema.prisma')).toBe('prisma')
    expect(langOfPath('message.proto')).toBe('proto')
    expect(langOfPath('CMakeLists.txt')).toBe('cmake')
    expect(langOfPath('main.tf')).toBe('terraform')
    expect(langOfPath('main.hcl')).toBe('hcl')
    expect(langOfPath('deploy.ps1')).toBe('powershell')
    expect(langOfPath('module.v')).toBe('verilog')
  })

  it('maps extension-less well-known filenames (case-insensitive)', () => {
    expect(langOfPath('Dockerfile')).toBe('dockerfile')
    expect(langOfPath('Makefile')).toBe('make')
  })

  it('maps Dockerfile variants by prefix', () => {
    expect(langOfPath('Dockerfile.dev')).toBe('dockerfile')
    expect(langOfPath('dockerfile.prod')).toBe('dockerfile')
    expect(langOfPath('Dockerfile.alpine')).toBe('dockerfile')
    expect(langOfPath('docker/Dockerfile')).toBe('dockerfile')
  })

  it('returns undefined for unknown or budget-removed languages', () => {
    expect(langOfPath('README')).toBeUndefined()
    expect(langOfPath('data.bin')).toBeUndefined()
    expect(langOfPath('.gitignore')).toBeUndefined()
    expect(langOfPath('dir/')).toBeUndefined()
    expect(langOfPath('Gemfile')).toBeUndefined() // ruby 移除（依赖图过重）
    expect(langOfPath('app.rb')).toBeUndefined()
    expect(langOfPath('style.less')).toBe('css') // less 以 css 近似
  })

  it('handles windows separators and deep paths', () => {
    expect(langOfPath('C:\\src\\app\\main.ts')).toBe('typescript')
    expect(langOfPath('C:\\src\\app\\App.vue')).toBe('vue')
    expect(langOfPath('a/b/c/d.txt')).toBeUndefined()
    expect(langOfPath('a/b/Dockerfile.prod')).toBe('dockerfile')
  })
})
