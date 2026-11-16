import React from "react";
import {expect,it} from "vitest";
import {render,screen} from "@testing-library/react";
import CountBadgePill from "./count-badge-pill";
it("renders counts as readable noninteractive indicators and uses neutral color at rest",()=>{
 const {rerender}=render(<CountBadgePill color="blue" rest={false}>3</CountBadgePill>);
 expect(screen.getByRole("status").textContent).toBe("3");expect(screen.getByRole("status").style.color).toBe("rgb(96, 165, 250)");
 expect(screen.queryByRole("button")).toBeNull();
 rerender(<CountBadgePill color="blue" rest>0</CountBadgePill>);
 expect(screen.getByRole("status").textContent).toBe("0");expect(screen.getByRole("status").style.color).toBe("rgb(203, 213, 225)");
});
