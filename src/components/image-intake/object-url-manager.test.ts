import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createObjectUrlManager } from "./object-url-manager";

beforeEach(() => {
  let counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mock-${++counter}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createDummyFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("createObjectUrlManager", () => {
  it("生成したURLをidに紐付けて返す", () => {
    const manager = createObjectUrlManager();
    const url = manager.create("1", createDummyFile("a.png"));
    expect(url).toBe("blob:mock-1");
  });

  it("個別削除時にそのidのURLだけrevokeする", () => {
    const manager = createObjectUrlManager();
    const urlA = manager.create("1", createDummyFile("a.png"));
    manager.create("2", createDummyFile("b.png"));

    manager.revoke("1");

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(urlA);
  });

  it("revokeAllで生成済みの全URLを解放する", () => {
    const manager = createObjectUrlManager();
    manager.create("1", createDummyFile("a.png"));
    manager.create("2", createDummyFile("b.png"));

    manager.revokeAll();

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("存在しないidをrevokeしても何も起きない", () => {
    const manager = createObjectUrlManager();
    manager.revoke("unknown");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revoke済みのidを再度revokeしても二重解放しない", () => {
    const manager = createObjectUrlManager();
    manager.create("1", createDummyFile("a.png"));
    manager.revoke("1");
    manager.revoke("1");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
