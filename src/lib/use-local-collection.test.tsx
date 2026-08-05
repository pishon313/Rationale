import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalCollection } from "./use-local-collection";

const repository = vi.hoisted(() => ({
  loadCollection: vi.fn(),
  saveCollection: vi.fn(),
  notifyPersistenceSubscriber: null as null | (() => void),
}));

vi.mock("./local-repository", () => ({
  loadCollection: repository.loadCollection,
  saveCollection: repository.saveCollection,
}));

type Item = { id: string };

function PersistenceSubscriber() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    repository.notifyPersistenceSubscriber = () => setVersion((value) => value + 1);
    return () => { repository.notifyPersistenceSubscriber = null; };
  }, []);
  return null;
}

function CollectionHarness() {
  const collection = useLocalCollection<Item>("items", []);
  return <>
    <PersistenceSubscriber />
    <button onClick={() => {
      collection.add({ id: "first" });
      collection.add({ id: "second" });
    }}>add</button>
    <output>{collection.items.map((item) => item.id).join(",")}</output>
  </>;
}

describe("useLocalCollection", () => {
  beforeEach(() => {
    repository.loadCollection.mockReset().mockResolvedValue([]);
    repository.saveCollection.mockReset().mockImplementation(async () => {
      repository.notifyPersistenceSubscriber?.();
    });
    repository.notifyPersistenceSubscriber = null;
  });

  it("persists outside React's state updater and preserves consecutive updates", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<CollectionHarness />);
    await waitFor(() => expect(repository.loadCollection).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "add" }));

    expect(screen.getByText("second,first")).toBeInTheDocument();
    expect(repository.saveCollection).toHaveBeenNthCalledWith(1, "items", [{ id: "first" }]);
    expect(repository.saveCollection).toHaveBeenNthCalledWith(2, "items", [{ id: "second" }, { id: "first" }]);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining("Cannot update a component"));
    consoleError.mockRestore();
  });
});
