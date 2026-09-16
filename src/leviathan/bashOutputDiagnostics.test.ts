import { describe, expect, test } from 'bun:test'
import { buildCommandFailureHint } from '../tools/BashTool/outputDiagnostics.js'
import { BashTool } from '../tools/BashTool/BashTool.js'

describe('bash output diagnostics', () => {
  test('explains a Windows path inside a Python string literal', () => {
    const hint = buildCommandFailureHint(
      '',
      `  File "C:\\Temp\\probe_pdf.py", line 2\r\n    name = "C:\\Users\\yini\\probe.pdf"\r\n           ^^^^^^^^^^^^^^^^^^^^^^^^^\r\nSyntaxError: (unicode error) 'unicodeescape' codec can't decode bytes in position 2-3: truncated \\UXXXXXXXX escape`,
    )
    expect(hint).not.toBeNull()
    expect(hint).toContain('raw string')
    expect(hint).toContain('<command_hint>')
  })

  test('explains an unterminated Python string in a generated script', () => {
    const hint = buildCommandFailureHint(
      '',
      `    print(name.split('\\\\')[-1], '| pages:', 12, '| 首页文本长度:', len(txt))\nSyntaxError: unterminated string literal (detected at line 11)`,
    )
    expect(hint).toContain('raw string')
  })

  test('explains an unterminated shell quote', () => {
    const hint = buildCommandFailureHint(
      '',
      `/usr/bin/bash: eval: line 1: unexpected EOF while looking for matching '"'`,
    )
    expect(hint).toContain('unterminated quote')
  })

  test('explains a heredoc whose terminator never matched', () => {
    const hint = buildCommandFailureHint(
      '',
      `bash: warning: here-document at line 3 delimited by end-of-file (wanted 'PYEOF')`,
    )
    expect(hint).toContain('heredoc terminator')
  })

  test('explains a Windows path rejected by a WSL shell', () => {
    const hint = buildCommandFailureHint(
      '',
      `bash: line 1: cd: C:/Users/yini/AppData/Local/Temp: No such file or directory`,
    )
    expect(hint).toContain('/mnt/c/')
  })

  test('stays quiet for ordinary output and ordinary failures', () => {
    expect(buildCommandFailureHint('hello\nworld', '')).toBeNull()
    expect(
      buildCommandFailureHint(
        '',
        'Traceback (most recent call last):\n  File "a.py", line 3\nValueError: nope',
      ),
    ).toBeNull()
  })

  test('attaches the hint to the tool result the model receives', () => {
    const block = BashTool.mapToolResultToToolResultBlockParam(
      {
        stdout: '',
        stderr:
          "SyntaxError: (unicode error) 'unicodeescape' codec can't decode bytes in position 2-3: truncated \\UXXXXXXXX escape",
        interrupted: false,
        isImage: false,
      } as never,
      'toolu_test',
    )

    expect(String(block.content)).toContain('<command_hint>')
    expect(String(block.content)).toContain('raw string')
  })
})
