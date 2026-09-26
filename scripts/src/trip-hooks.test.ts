import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("Trip calls every hook unconditionally before loading/error/missing-data returns", () => {
  const source = ts.createSourceFile(
    "trip.tsx",
    readFileSync(new URL("../../artifacts/travel-optimizer/src/pages/trip.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );
  const trip = source.statements.find(
    (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "Trip",
  );
  assert.ok(trip?.body);
  let canHaveReturned = false;
  let hookCount = 0;
  for (const statement of trip.body.statements) {
    let returns = false;
    function visit(node: ts.Node, conditional = false) {
      // Callback returns and hooks in separate components do not execute as
      // part of Trip's render. Inspect only Trip's own control flow.
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node)) returns = true;
      if (ts.isCallExpression(node) && /^use[A-Z]/.test(node.expression.getText(source))) {
        hookCount++;
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        assert.equal(canHaveReturned || conditional, false,
          `${node.expression.getText(source)} at line ${line} can be skipped during a render`);
      }
      const branches = conditional || ts.isIfStatement(node) || ts.isConditionalExpression(node)
        || ts.isSwitchStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node)
        || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)
        || (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
      ts.forEachChild(node, (child) => visit(child, branches));
    }
    visit(statement);
    canHaveReturned ||= returns;
  }
  assert.ok(hookCount > 0, "The guard must inspect Trip's hooks");
});
