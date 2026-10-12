import { expect, test } from "vitest";
import { routeStep, arrivalPosition, selectedForce } from "./conflict-board-ui.js";
const board = { connections: [["approach", "B3"], ["B3", "B2"]], approach: "approach", objective: "post", reserve: "reserve" };
test("connected explicit routes, rejection and backtracking preserve the committed route", () => {
  const committed = ["B3"];
  let draft = routeStep(board, "approach", [], "B3");
  expect(routeStep(board, "approach", draft, "post")).toBe(draft);
  draft = routeStep(board, "approach", draft, "B2");
  expect(draft).toEqual(["B3", "B2"]);
  expect(routeStep(board, "approach", draft, "B3")).toEqual(["B3"]);
  expect(committed).toEqual(["B3"]);
});
test("travel order entry mirrors the owner/post/reserve asymmetry without exposing rivals", () => {
  const data = { originalOwner: "red", commandPostController: "red", view: { viewer: "red", board, own: [], ownArrivals: [{ formation: { id: "ours" } }] } };
  expect(arrivalPosition(data)).toBe("post");
  data.commandPostController = "blue";
  expect(arrivalPosition(data)).toBe("reserve");
  data.view.viewer = "blue";
  expect(selectedForce(data, "ours").formation.position).toBe("approach");
  expect(selectedForce(data, "enemy")).toBeNull();
});
