import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
vi.mock("@/hooks/use-brand",()=>({useBrand:()=>({primary:"#4A8FAF",name:"Test Company"})}));
vi.mock("react-i18next",()=>({useTranslation:()=>({t:(_key:string,options:{defaultValue:string})=>options.defaultValue})}));
import RoleBadge from "./role-badge";
import EmployeeRolePill from "./employee-role-pill";
it.each([["office","Office Staff"],["field","Field"],["both","Both"],["foreman","Foreman"],["gatekeeper","Gatekeeper"],["member","Office Staff"],["ap","Accounts Payable"],["field_employee","Field Employee"]])("keeps %s readable as a noninteractive status indicator",(role,label)=>{
 render(<RoleBadge role={role}/>);expect(screen.getByRole("status").textContent).toBe(label);expect(screen.queryByRole("button")).toBeNull();expect(screen.queryByRole("img")).toBeNull();
});
it("keeps Admin as an amber authority indicator",()=>{
 render(<RoleBadge role="admin"/>);expect(screen.getByRole("status").style.color).toBe("rgb(251, 191, 36)");expect(screen.getByRole("status").textContent).toBe("Admin");
});
it("shares the indicator with the employee wrapper",()=>{
 render(<EmployeeRolePill role="field"/>);expect(screen.getByRole("status").textContent).toBe("Field");
});
