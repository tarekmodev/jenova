import { Controller, Get } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import {
  REQUIRES_APP_METADATA,
  RequiresApp,
  SKIP_GATEWAY_METADATA,
  SkipGateway,
} from "./decorators";

@Controller("decorated")
class DecoratedController {
  @Get("gated")
  @RequiresApp("b2b")
  gated(): void {}

  @Get("open")
  open(): void {}
}

@SkipGateway()
@Controller("probes")
class BypassedController {
  @Get("probe")
  probe(): void {}
}

@RequiresApp("crm")
@Controller("crm")
class ClassGatedController {
  @Get("plain")
  plain(): void {}

  @Get("overridden")
  @RequiresApp("desk")
  overridden(): void {}
}

const reflector = new Reflector();

describe("@RequiresApp", () => {
  it("stores the appKey as handler metadata the guard can read", () => {
    expect(reflector.get(REQUIRES_APP_METADATA, DecoratedController.prototype.gated)).toBe("b2b");
  });

  it("leaves undecorated handlers without metadata", () => {
    expect(reflector.get(REQUIRES_APP_METADATA, DecoratedController.prototype.open)).toBeUndefined();
  });

  it("applies at class level and lets a handler override it", () => {
    const targets = (handler: (...args: never[]) => unknown) =>
      reflector.getAllAndOverride<string>(REQUIRES_APP_METADATA, [handler, ClassGatedController]);
    expect(targets(ClassGatedController.prototype.plain)).toBe("crm");
    expect(targets(ClassGatedController.prototype.overridden)).toBe("desk");
  });
});

describe("@SkipGateway", () => {
  it("flags a controller so the whole gateway chain is bypassed", () => {
    expect(
      reflector.getAllAndOverride<boolean>(SKIP_GATEWAY_METADATA, [
        BypassedController.prototype.probe,
        BypassedController,
      ]),
    ).toBe(true);
  });

  it("is absent everywhere else", () => {
    expect(
      reflector.getAllAndOverride<boolean>(SKIP_GATEWAY_METADATA, [
        DecoratedController.prototype.gated,
        DecoratedController,
      ]),
    ).toBeUndefined();
  });
});
