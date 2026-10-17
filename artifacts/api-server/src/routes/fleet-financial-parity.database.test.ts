import {it,expect,vi} from "vitest";import {randomUUID} from "node:crypto";import express from "express";import cookieParser from "cookie-parser";import request from "supertest";
import {buildTestCookie} from "../test-utils/session";
import {assertFreshLocalTestDatabaseEnvironment} from "../../../../scripts/fresh-test-database.mjs";
const pdf=vi.hoisted(()=>vi.fn(async(_input:any)=>Buffer.from("synthetic-pdf-port")));
vi.mock("../lib/invoice-pdf",()=>({renderInvoicePdf:pdf}));
it("keeps reviewed Fleet quantities and rates in invoice/PDF reads and refuses generic line repricing",async()=>{
 assertFreshLocalTestDatabaseEnvironment(process.env);const {db,usersTable,vendorsTable,partnersTable,invoicesTable,invoiceLinesTable}=await import("@workspace/db"),{eq}=await import("drizzle-orm");
 const marker=randomUUID(),[partner]=await db.insert(partnersTable).values({name:`Synthetic finance ${marker}`,contactName:"Synthetic contact",contactEmail:`${marker}@example.com`}).returning(),[vendor]=await db.insert(vendorsTable).values({name:`Synthetic carrier ${marker}`,contactName:"Synthetic contact",contactEmail:`${marker}@example.com`}).returning(),[user]=await db.insert(usersTable).values({username:`${marker}@example.com`,passwordHash:"synthetic-only",role:"admin",displayName:"Synthetic office"}).returning();
 const [invoice]=await db.insert(invoicesTable).values({invoiceNumber:`SYN-${marker}`,vendorId:vendor.id,partnerId:partner.id,cadence:"per_ticket",status:"draft",periodStart:new Date(),periodEnd:new Date(),subtotal:"1.54",taxTotal:"0.10",total:"1.64"}).returning();
 const metadata={version:2,charge:{id:randomUUID(),revision:1,quantity:"123.456789",unitRate:"0.0125",exactAmount:"1.5432098625",currencyAmount:"1.54",currency:"USD",reviewedByUserId:user.id,reviewedAt:new Date().toISOString()}};
 const [line]=await db.insert(invoiceLinesTable).values({invoiceId:invoice.id,sourceType:"ticket_line_item",sourceId:77,lineType:"other",description:"Synthetic reviewed crude",quantity:"123.4568",unitPrice:"0.0125",preciseQuantity:"123.456789",preciseUnitPrice:"0.0125",amount:"1.54",taxAmount:"0.10",fleetBillingMetadata:metadata}).returning();
 const {default:router}=await import("./invoices"),app=express().use(express.json()).use(cookieParser()).use(router),cookie=buildTestCookie({userId:user.id,role:"admin",sv:user.sessionVersion});
 const read=await request(app).get(`/invoices/${invoice.id}`).set("Cookie",cookie);expect(read.status).toBe(200);expect(read.body.lines[0]).toMatchObject({quantity:"123.456789",unitPrice:"0.0125",amount:"1.54"});
 const rendered=await request(app).get(`/invoices/${invoice.id}/pdf`).set("Cookie",cookie);expect(rendered.status).toBe(200);expect(pdf.mock.calls[0][0].lines[0]).toMatchObject({quantity:"123.456789",unitPrice:"0.0125",amount:"1.54"});
 const edited=await request(app).patch(`/invoices/${invoice.id}/lines/${line.id}`).set("Cookie",cookie).send({quantity:"999",unitPrice:"999",taxable:false});expect(edited.status).toBe(409);expect(edited.body.code).toBe("fleet.derived_charge_locked");
 const [saved]=await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.id,line.id));expect(saved.amount).toBe("1.54");expect(saved.fleetBillingMetadata).toEqual(metadata);
});
