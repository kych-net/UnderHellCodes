// 打包 .vsix。先编译再调 vsce。
import { execSync } from 'node:child_process'
import process from 'node:process'

execSync('npm run compile', { stdio: 'inherit' })
execSync('vsce package', { stdio: 'inherit', cwd: process.cwd() })