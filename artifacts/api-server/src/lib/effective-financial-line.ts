export {resolveEffectiveFinancialLine,sumEffectiveFinancialLines,effectiveFinancialAmountSql,type FinancialLineInput} from "@workspace/db/format";
import {resolveEffectiveFinancialLine,parseExactDecimal,multiplyExact,roundExact,formatExact,type FinancialLineInput} from "@workspace/db/format";
/** Invoice-only calculation metadata preserves exact jurisdiction rates despite
 * the historical four-decimal display column. Original charge data is unchanged. */
export function projectEffectiveInvoiceLine<T extends FinancialLineInput & {taxAmount?:string|null}>(line:T){
 if(!line.fleetBillingMetadata)return line;
 const effective=resolveEffectiveFinancialLine(line),metadata=line.fleetBillingMetadata as Record<string,unknown>,raw=metadata.invoiceTax;
 if(raw===undefined)return {...line,quantity:effective.quantity,unitPrice:effective.unitPrice};
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid Fleet invoice tax source");
 const tax=raw as Record<string,unknown>;
 if(tax.version!==1||typeof tax.rate!=="string"||tax.basis!==effective.currencyAmount||typeof tax.amount!=="string"||tax.rounding!=="per_line_half_away_from_zero")throw Error("Invalid Fleet invoice tax source");
 const rate=parseExactDecimal(tax.rate),amount=formatExact(roundExact(multiplyExact(parseExactDecimal(effective.currencyAmount),rate),{scale:2,rounding:"half_away_from_zero"}));
 if(rate.coefficient<0n||formatExact(parseExactDecimal(tax.amount))!==amount||line.taxAmount!=null&&formatExact(parseExactDecimal(line.taxAmount))!==amount)throw Error("Fleet invoice tax source mismatch");
 return {...line,quantity:effective.quantity,unitPrice:effective.unitPrice,taxRate:formatExact(rate)};
}
