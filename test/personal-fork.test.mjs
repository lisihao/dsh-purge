import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateArchive } from "../lib/community.js";

test("personal fork accepts its packages and only named legacy rollback baselines", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-fork-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pack = path.join(root, "package"); fs.mkdirSync(pack);
  async function validate(repo, version, expected = version) {
    fs.writeFileSync(path.join(pack, "package.json"), JSON.stringify({name:"dsh-purge-community", version, repository:{url:`https://github.com/${repo}.git`}}));
    const archive = path.join(root, "fixture.tgz");
    execFileSync("tar", ["-czf",archive,"-C",root,"package"]);
    return validateArchive(archive, expected);
  }
  assert.equal((await validate("lisihao/dsh-purge", "1.6.48")).version, "1.6.48");
  for (const version of ["1.6.36", "1.6.38"])
    assert.equal((await validate("kingcharleslzy-ai/dsh-purge", version)).version, version);
  await assert.rejects(validate("kingcharleslzy-ai/dsh-purge", "1.6.48"), /身份/);
  await assert.rejects(validate("unrelated/dsh-purge", "1.6.38"), /身份/);
  await assert.rejects(validate("lisihao/dsh-purge", "1.6.48", "1.6.49"), /身份/);
});
