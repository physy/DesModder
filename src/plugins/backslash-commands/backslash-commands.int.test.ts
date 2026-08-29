import { clean, Driver, testWithPage } from "#tests";
import type { KeyInput } from "puppeteer";

declare const DSM: import("#DSM").default;

async function pressKeys(driver: Driver, keys: KeyInput[]) {
  for (const key of keys) await driver.keyboard.press(key);
}

testWithPage("Backslash Commands", async (driver) => {
  await driver.enablePlugin("backslash-commands");
  await driver.focusIndex(0);

  await pressKeys(driver, ["Backslash", "s", "q", "r", "t"]);
  await driver.assertSelector(".dsm-latex-command-input");
  expect(
    await driver.$eval(".dsm-latex-command-input", (el) =>
      el.textContent?.replace(/\u200b/g, "")
    )
  ).toBe("\\sqrt");

  await pressKeys(driver, ["ArrowLeft"]);
  expect(
    await driver.$eval(".dsm-latex-command-input", (el) =>
      el.getAttribute("data-cursor-index")
    )
  ).toBe("3");
  await driver.click('[data-dsm-command-index="1"]');
  expect(
    await driver.$eval(".dsm-latex-command-input", (el) =>
      el.getAttribute("data-cursor-index")
    )
  ).toBe("1");
  await pressKeys(driver, [
    "ArrowRight",
    "ArrowRight",
    "ArrowRight",
    "ArrowRight",
  ]);
  expect(
    await driver.$eval(".dsm-latex-command-input", (el) =>
      el.getAttribute("data-cursor-index")
    )
  ).toBe("4");

  await pressKeys(driver, ["{", "x", "}", "Enter"]);
  await driver.assertSelectorNot(".dsm-latex-command-input");
  await driver.assertSelectedItemLatex("\\sqrt{x}");

  await pressKeys(driver, [
    "Backslash",
    ...Array<KeyInput>(32).fill("a"),
    ...Array<KeyInput>(32).fill("Backspace"),
    "Backspace",
  ]);
  await driver.assertSelectorNot(".dsm-latex-command-input");
  await driver.assertSelectedItemLatex("\\sqrt{x}");

  await pressKeys(driver, ["Backslash", "Shift"]);
  await driver.assertSelector(".dsm-latex-command-input");
  await pressKeys(driver, ["Backspace"]);
  await driver.assertSelectorNot(".dsm-latex-command-input");
  await driver.assertSelectedItemLatex("\\sqrt{x}");

  await pressKeys(driver, ["Backslash", "f", "o", "o", "Space", "b", "a", "r"]);
  expect(
    await driver.$eval(".dsm-latex-command-input", (el) =>
      el.textContent?.replace(/\u200b/g, "")
    )
  ).toBe("\\foo bar");
  await pressKeys(driver, ["Escape"]);
  await driver.assertSelectedItemLatex("\\sqrt{x}");

  await pressKeys(driver, [
    "ArrowRight",
    "+",
    "Backslash",
    "a",
    "l",
    "p",
    "h",
    "a",
  ]);
  await driver.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await driver.assertSelectedItemLatex("\\sqrt{x}+\\alpha");

  await pressKeys(driver, [
    "+",
    "Backslash",
    "f",
    "r",
    "a",
    "c",
    "{",
    "a",
    "+",
    "1",
    "}",
    "{",
    "b",
    "_",
    "2",
    "}",
    "Enter",
  ]);
  await driver.assertSelectedItemLatex("\\sqrt{x}+\\alpha+\\frac{a+1}{b_{2}}");

  await driver.clean();
  return clean;
});

testWithPage("Custom Backslash Commands", async (driver) => {
  await driver.enablePlugin("backslash-commands");
  await driver.setPluginSetting("backslash-commands", "customCommands", [
    { name: "polygon", expansion: "\\operatorname{polygon}" },
    { name: "avg", expansion: "\\frac{$1+$2}{2}" },
    { name: "a", expansion: "\\alpha" },
  ]);
  await driver.focusIndex(0);

  await pressKeys(driver, [
    "Backslash",
    "a",
    "v",
    "g",
    "{",
    "a",
    "}",
    "{",
    "b",
    "}",
    "Enter",
  ]);
  await driver.assertSelectedItemLatex("\\frac{a+b}{2}");

  await pressKeys(driver, ["+", "Backslash", "a", "v", "g", "1", "2", "Enter"]);
  await driver.assertSelectedItemLatex("\\frac{a+b}{2}+\\frac{1+2}{2}");

  await pressKeys(driver, [
    "+",
    "Backslash",
    "a",
    "v",
    "g",
    "Space",
    "a",
    "Space",
    "b",
    "Enter",
  ]);
  await driver.assertSelectedItemLatex(
    "\\frac{a+b}{2}+\\frac{1+2}{2}+\\frac{a+b}{2}"
  );

  await pressKeys(driver, [
    "+",
    "Backslash",
    "p",
    "o",
    "l",
    "y",
    "g",
    "o",
    "n",
    "Enter",
  ]);
  await driver.assertSelectedItemLatex(
    "\\frac{a+b}{2}+\\frac{1+2}{2}+\\frac{a+b}{2}+\\operatorname{polygon}"
  );

  await pressKeys(driver, [
    "+",
    "Backslash",
    "p",
    "m",
    "Backslash",
    "a",
    "Enter",
  ]);
  await driver.assertSelectedItemLatex(
    "\\frac{a+b}{2}+\\frac{1+2}{2}+\\frac{a+b}{2}+\\operatorname{polygon}+\\pm\\alpha"
  );

  await driver.clean();
  return clean;
});

testWithPage("Custom Command Expansion Editor", async (driver) => {
  await driver.enablePlugin("backslash-commands");
  await driver.evaluate(() => {
    DSM.pillboxMenus!.toggleMenu("main-menu", true);
    DSM.pillboxMenus!.toggleCategoryExpanded("utility");
    DSM.pillboxMenus!.togglePluginExpanded("backslash-commands");
  });

  await driver.assertSelectorNot(".dsm-settings-custom-commands-header");
  await driver.click(".dsm-settings-custom-command-add .dsm-btn-icon");
  await driver.waitForFunction(() =>
    document.querySelector(".dsm-settings-custom-commands-header")
  );
  expect(
    await driver.evaluate(
      () => DSM.pluginSettings["backslash-commands"]!.customCommands.length
    )
  ).toBe(1);
  await driver.waitForFunction(() =>
    document.querySelector(".dsm-settings-custom-command-expansion")
  );
  await driver.click(
    ".dsm-settings-custom-command-expansion .dcg-inline-math-input-view"
  );
  await driver.waitForFunction(() =>
    document
      .querySelector(".dsm-settings-custom-command-expansion")
      ?.contains(document.activeElement)
  );
  await pressKeys(driver, [
    "Backslash",
    "v",
    "a",
    "r",
    "e",
    "p",
    "s",
    "i",
    "l",
    "o",
    "n",
    "Enter",
  ]);
  expect(
    await driver.evaluate(
      () =>
        DSM.pluginSettings["backslash-commands"]!.customCommands[0]!
          .expansion
    )
  ).toBe("\\varepsilon");
  await driver.click(
    ".dsm-settings-custom-command-expansion .dcg-inline-math-input-view"
  );
  await driver.waitForFunction(() =>
    document
      .querySelector(".dsm-settings-custom-command-expansion")
      ?.contains(document.activeElement)
  );
  await driver.evaluate(() =>
    DSM.pillboxMenus!.togglePluginExpanded("code-golf")
  );
  await driver.waitForFunction(
    () =>
      !document
        .querySelector(".dsm-settings-custom-command-expansion")
        ?.contains(document.activeElement)
  );
  await driver.evaluate(() =>
    DSM.pillboxMenus!.togglePluginExpanded("backslash-commands")
  );
  await driver.waitForFunction(() =>
    document.querySelector(".dsm-settings-custom-command-expansion")
  );
  expect(
    await driver.evaluate(() =>
      document
        .querySelector(".dsm-settings-custom-command-expansion")
        ?.contains(document.activeElement)
    )
  ).toBe(false);
  await driver.click(
    ".dsm-settings-custom-command-expansion .dcg-inline-math-input-view"
  );
  await driver.waitForFunction(() =>
    document
      .querySelector(".dsm-settings-custom-command-expansion")
      ?.contains(document.activeElement)
  );
  await driver.evaluate(() => DSM.pillboxMenus!.toggleMenu("main-menu", false));
  await driver.waitForFunction(
    () =>
      !document
        .querySelector(".dsm-settings-custom-command-expansion")
        ?.contains(document.activeElement)
  );
  await driver.evaluate(() => DSM.pillboxMenus!.toggleMenu("main-menu", true));
  expect(
    await driver.evaluate(() =>
      document
        .querySelector(".dsm-settings-custom-command-expansion")
        ?.contains(document.activeElement)
    )
  ).toBe(false);
  expect(
    await driver.evaluate(
      () =>
        DSM.pluginSettings["backslash-commands"]!.customCommands[0]!
          .expansion
    )
  ).toBe("\\varepsilon");

  await driver.evaluate(() => DSM.pillboxMenus!.toggleMenu("main-menu", false));
  await driver.clean();
  return clean;
});
