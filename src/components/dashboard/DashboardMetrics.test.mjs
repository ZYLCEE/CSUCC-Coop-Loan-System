import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { formatPeso } from "./dashboard-model.ts";

const source = readFileSync(new URL("./DashboardMetrics.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

function loadComponent() {
  const dependencies = {
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "lucide-react": { Clock: "Clock", TrendingUp: "TrendingUp", Users: "Users", Wallet: "Wallet" },
    "./StatCard": { __esModule: true, default: (props) => ({ type: "StatCard", props }) },
    "./dashboard-model": { formatPeso },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => dependencies[name], exports);
  return exports.default;
}

const baseProps = {
  pending: 0,
  activeMembers: 0,
  disbursement: 0,
  collections: 1234.56,
  period: "this-month",
  financialsLoading: false,
  membersLoading: false,
  financialsError: null,
  membersError: null,
  retryFinancials: () => {},
  retryMembers: () => {},
};

test("the collections card displays the confirmed reporting value as currency", () => {
  const dashboard = loadComponent()(baseProps);
  const collections = dashboard.props.children[2].props;

  assert.equal(collections.label, "Monthly Collections");
  assert.equal(collections.value, formatPeso(1234.56));
});

test("the collections card shows unavailable and retries when financial reporting fails", () => {
  let retried = false;
  const dashboard = loadComponent()({
    ...baseProps,
    collections: null,
    financialsError: "offline",
    retryFinancials: () => { retried = true; },
  });
  const collections = dashboard.props.children[2].props;

  assert.equal(collections.value, "—");
  assert.equal(collections.unavailable, "Confirmed collections unavailable");
  collections.onRetry();
  assert.equal(retried, true);
});
