import {parseExactDecimal,formatExact,multiplyExact,roundExact,addExact,type ExactDecimal} from "./exact-decimal";
export type FinancialLineInput={quantity?:string|number|null;unitPrice?:string|number|null;preciseQuantity?:string|null;preciseUnitPrice?:string|null;fleetBillingMetadata?:unknown};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid reviewed Fleet financial source");return value as Record<string,unknown>;};
const amount=(value:unknown):ExactDecimal=>{if(typeof value!=="string"||! /^-?(?:0|[1-9]\d{0,63})(?:\.\d{1,72})?$/.test(value))throw Error("Invalid exact Fleet amount");const negative=value.startsWith("-"),[whole,fraction=""]=(negative?value.slice(1):value).split(".");return {coefficient:BigInt(whole+fraction)*(negative?-1n:1n),scale:fraction.length};};
/** The reviewed currency amount is authoritative. Recomputing it from a rounded
 * display quantity/rate loses precision, especially for detention minute ratios. */
export function resolveEffectiveFinancialLine(line:FinancialLineInput){
 if(line.fleetBillingMetadata!==undefined&&line.fleetBillingMetadata!==null){
  const meta=object(line.fleetBillingMetadata);if(meta.version!==2)throw Error("Unknown Fleet financial version");const c=object(meta.charge);
  if(typeof c.id!=="string"||! /^[0-9a-f-]{36}$/i.test(c.id)||!Number.isSafeInteger(c.revision)||Number(c.revision)<1||!Number.isSafeInteger(c.reviewedByUserId)||Number(c.reviewedByUserId)<1||typeof c.reviewedAt!=="string"||!Number.isFinite(Date.parse(c.reviewedAt))||c.currency!=="USD"||typeof c.quantity!=="string"||typeof c.unitRate!=="string"||typeof c.currencyAmount!=="string")throw Error("Unreviewed Fleet financial source");
  const quantity=formatExact(parseExactDecimal(c.quantity)),unitPrice=formatExact(parseExactDecimal(c.unitRate)),exact=amount(c.exactAmount),currencyAmount=formatExact(roundExact(amount(c.currencyAmount),{scale:2,rounding:"half_away_from_zero"}));
  if(currencyAmount!==formatExact(roundExact(exact,{scale:2,rounding:"half_away_from_zero"}))||line.preciseQuantity!=null&&formatExact(parseExactDecimal(line.preciseQuantity))!==quantity||line.preciseUnitPrice!=null&&formatExact(parseExactDecimal(line.preciseUnitPrice))!==unitPrice)throw Error("Fleet financial source mismatch");
  return {version:2 as const,quantity,unitPrice,exactAmount:formatExact(exact),currencyAmount,currency:"USD" as const,chargeId:c.id,revision:Number(c.revision),fleetBillingMetadata:line.fleetBillingMetadata};
 }
 const quantity=String(line.quantity??"0"),unitPrice=String(line.unitPrice??"0"),exact=multiplyExact(parseExactDecimal(quantity),parseExactDecimal(unitPrice));
 return {version:1 as const,quantity,unitPrice,exactAmount:formatExact(exact),currencyAmount:formatExact(roundExact(exact,{scale:2,rounding:"half_away_from_zero"})),currency:"USD" as const,chargeId:null,revision:null,fleetBillingMetadata:null};
}
export function sumEffectiveFinancialLines(lines:readonly FinancialLineInput[]){const total=lines.reduce((sum,line)=>addExact(sum,amount(resolveEffectiveFinancialLine(line).currencyAmount)),parseExactDecimal("0"));return {currency:"USD" as const,currencyAmount:formatExact(total)};}
/** Only constant SQL identifier aliases are accepted. Legacy expression is
 * deliberately unchanged; v2 aggregates consume reviewed payable cents. */
export function effectiveFinancialAmountSql(alias=""){
 if(alias&&!/^[a-z_][a-z0-9_]*$/i.test(alias))throw Error("Invalid financial SQL alias");const prefix=alias?`${alias}.`:"";
 return `(CASE WHEN ${prefix}fleet_billing_metadata->>'version'='2' THEN (${prefix}fleet_billing_metadata->'charge'->>'currencyAmount')::numeric ELSE ${prefix}quantity * ${prefix}unit_price END)`;
}
