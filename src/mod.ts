/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/brace-style */
import type { DependencyContainer } from "tsyringe";
import type { ProfileHelper } from "@spt/helpers/ProfileHelper";
import type { StaticRouterModService } from "@spt/services/mod/staticRouter/StaticRouterModService";
import type { SaveServer } from "@spt/servers/SaveServer";
import type { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import type { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import type { ItemHelper } from "@spt/helpers/ItemHelper";
import type { HashUtil } from "@spt/utils/HashUtil";
import type { DatabaseServer } from "@spt/servers/DatabaseServer";
import type { ILogger } from "@spt/models/spt/utils/ILogger";
import { BaseClasses } from "@spt/models/enums/BaseClasses";
import { ItemTpl } from "@spt/models/enums/ItemTpl";
import { Traders } from "@spt/models/enums/Traders";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";
import type { GameController } from "@spt/controllers/GameController";
import type { IEmptyRequestData } from "@spt/models/eft/common/IEmptyRequestData";
import type { ITrader } from "@spt/models/eft/common/tables/ITrader";
import type { ITemplateItem } from "@spt/models/eft/common/tables/ITemplateItem";
import { FileSystemSync } from "@spt/utils/FileSystemSync";
import { Debug } from "./debug";

import barters from "../config/barters.json";
import cases from "../config/cases.json";

import path from "path";
import { copyFileSync, existsSync } from "fs";
import JSON5 from "json5";

class Mod implements IPostDBLoadMod, IPreSptLoadMod {
    private HANDBOOK_GEARCASES = "5b5f6fa186f77409407a7eb7";
    newIdMap = {
        Golden_Key_Pouch: "661cb36922c9e10dc2d9514b",
        Golden_Keycard_Case: "661cb36f5441dc730e28bcb0",
        Golden_Keychain1: "661cb372e5eb56290da76c3e",
        Golden_Keychain2: "661cb3743bf00d3d145518b3",
        Golden_Keychain3: "661cb376b16226f648eb0cdc"
    };

    // These are keys that BSG added with no actual use, or drop chance. Ignore them for now
    // These should be confirmed every client update to still be unused
    private ignoredKeyList = [
        "5671446a4bdc2d97058b4569",
        "57518f7724597720a31c09ab",
        "57518fd424597720c85dbaaa",
        "5751916f24597720a27126df",
        "5751961824597720a31c09ac",
        "590de4a286f77423d9312a32",
        "590de52486f774226a0c24c2",
        "61a6446f4b5f8b70f451b166",
        "63a39ddda3a2b32b5f6e007a",
        "63a39e0f64283b5e9c56b282",
        "63a39e5b234195315d4020bf",
        "63a39e6acd6db0635c1975fe",
        "63a71f1a0aa9fb29da61c537",
        "63a71f3b0aa9fb29da61c539",
        "658199a0490414548c0fa83b",
        "6582dc63cafcd9485374dbc5"
    ];
    
    logger: ILogger
    modName: string
    modVersion: string
    container: DependencyContainer;
    profileHelper: ProfileHelper;
    itemHelper: ItemHelper;
    fileSystemSync: FileSystemSync;
    config: any;

    constructor() {
        this.modName = "Gilded Key Storage";
    }

    public preSptLoad(container: DependencyContainer): void {
        this.container = container;

        const staticRouterModService = container.resolve<StaticRouterModService>("StaticRouterModService")
        const saveServer = container.resolve<SaveServer>("SaveServer")
        const logger = container.resolve<ILogger>("WinstonLogger")
        this.profileHelper = container.resolve<ProfileHelper>("ProfileHelper");
        this.itemHelper = container.resolve<ItemHelper>("ItemHelper");
        this.fileSystemSync = container.resolve<FileSystemSync>("FileSystemSync");

        // Load our config
        this.loadConfig();

        // On game start, see if we need to fix issues from previous versions
        // Note: We do this as a method replacement so we can run _before_ SPT's gameStart
        container.afterResolution("GameController", (_, result: GameController) => {
            const originalGameStart = result.gameStart;

            result.gameStart = (url: string, info: IEmptyRequestData, sessionID: string, startTimeStampMS: number) => {
                // If there's a profile ID passed in, call our fixer method
                if (sessionID)
                {
                    this.fixProfile(sessionID);
                }

                // Call the original
                originalGameStart.apply(result, [url, info, sessionID, startTimeStampMS]);
            }
        });

        // Setup debugging if enabled
        const debugUtil = new Debug(this.config.debug)
        debugUtil.giveProfileAllKeysAndGildedCases(staticRouterModService, saveServer, logger)
        debugUtil.removeAllDebugInstanceIdsFromProfile(staticRouterModService, saveServer)
    }

    public postDBLoad(container: DependencyContainer): void {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.logger.log(`[${this.modName}] : Mod loading`, LogTextColor.GREEN);
        const debugUtil = new Debug(this.config.debug)
        const databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const dbTables = databaseServer.getTables();
        const restrInRaid = dbTables.globals.config.RestrictionsInRaid;
        const dbTemplates = dbTables.templates
        const dbTraders = dbTables.traders
        const dbItems = dbTemplates.items
        const dbLocales = dbTables.locales.global.en

        debugUtil.logRareKeys(this.logger, this.itemHelper, dbItems, dbLocales);
        this.combatibilityThings(dbItems)

        for (const caseName of Object.keys(cases))
        {
            this.createCase(container, cases[caseName], dbTables);
        }

        this.pushSupportiveBarters(dbTraders)
        this.adjustItemProperties(dbItems)
        this.setLabsCardInRaidLimit(restrInRaid, 9)

        debugUtil.logMissingKeys(this.logger, this.itemHelper, dbItems, dbLocales, this.ignoredKeyList)
    }

    loadConfig(): void {
        const userConfigPath = path.resolve(__dirname, "../config/config.json5");
        const defaultConfigPath = path.resolve(__dirname, "../config/config.default.json5");

        // Copy the default config if the user config doesn't exist yet
        if (!existsSync(userConfigPath))
        {
            copyFileSync(defaultConfigPath, userConfigPath);
        }

        // Create the config as a merge of the default and user configs, so we always
        // have the default values available, even if missing in the user config
        this.config = {
            ...JSON5.parse(this.fileSystemSync.read(defaultConfigPath)),
            ...JSON5.parse(this.fileSystemSync.read(userConfigPath))
        };
    }

    pushSupportiveBarters(dbTraders: Record<string, ITrader>):void{
        for (const barter of Object.keys(barters)){
            this.pushToTrader(barters[barter], barters[barter].id, dbTraders);
        }
    }

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    setLabsCardInRaidLimit(restrInRaid:any, limitAmount:number):void{
        if (restrInRaid === undefined) return

        //restrInRaid type set to any to shut the linter up because the type doesn't include MaxIn... props
        //set labs access card limit in raid to 9 so the keycard case can be filled while on pmc
        for (const restr in restrInRaid){
            const thisRestriction = restrInRaid[restr]
            if (thisRestriction.TemplateId === ItemTpl.KEYCARD_TERRAGROUP_LABS_ACCESS){
                thisRestriction.MaxInLobby = limitAmount;
                thisRestriction.MaxInRaid = limitAmount;
            }
        }
    }

    adjustItemProperties(dbItems: Record<string, ITemplateItem>){
        for (const [_, item] of Object.entries(dbItems)){
            // Skip anything that isn't specifically an Item type item
            if (item._type !== "Item")
            {
                continue;
            }

            const itemProps = item._props

            // Adjust key specific properties
            if (this.itemHelper.isOfBaseclass(item._id, BaseClasses.KEY)){

                if (this.config.weightless_keys){
                    itemProps.Weight = 0.0;
                }

                itemProps.InsuranceDisabled = !this.config.key_insurance_enabled;

                // If keys are to be set to no limit, and we're either not using the finite keys list, or this key doesn't exist
                // in it, set the key max usage to 0 (infinite)
                if (this.config.no_key_use_limit && 
                    (!this.config.use_finite_keys_list || !this.config.finite_keys_list.includes(item._id)))
                {
                    itemProps.MaximumNumberOfUsage = 0;
                }
                
                if (this.config.keys_are_discardable) {
                    // BSG uses DiscordLimit == 0 to flag as not insurable, so we need to swap to the flag
                    if (itemProps.DiscardLimit === 0)
                    {
                        itemProps.InsuranceDisabled = true;
                    }

                    itemProps.DiscardLimit = -1;
                }
            }

            // Remove keys from secure container exclude filter
            if (this.config.all_keys_in_secure && this.itemHelper.isOfBaseclass(item._id, BaseClasses.MOB_CONTAINER) && itemProps?.Grids) {
                // Theta container has multiple grids, so we need to loop through all grids
                for (const grid of itemProps.Grids) {
                    const filter = grid?._props?.filters[0];
                    if (filter)
                    {
                        // Exclude items with a base class of KEY. Have to check that it's an "Item" type first because isOfBaseClass only accepts Items
                        filter.ExcludedFilter = filter.ExcludedFilter.filter(
                            itemTpl => this.itemHelper.getItem(itemTpl)[1]?._type !== "Item" || !this.itemHelper.isOfBaseclass(itemTpl, BaseClasses.KEY)
                        );
                    }
                }
            }
        }
    }

    combatibilityThings(dbItems: Record<string, ITemplateItem>):void{
        //do a compatibility correction to make this mod work with other mods with destructive code (cough, SVM, cough)
        //basically just add the filters element back to backpacks and secure containers if they've been removed by other mods
        const compatFiltersElement = [{ Filter: [BaseClasses.ITEM], ExcludedFilter: [] }];

        for (const [_, item] of Object.entries(dbItems)){
            // Skip non-items
            if (item._type !== "Item") continue;

            if (
                item._parent === BaseClasses.BACKPACK ||
                item._parent === BaseClasses.VEST ||
                (this.itemHelper.isOfBaseclass(item._id, BaseClasses.MOB_CONTAINER) && item._id !== ItemTpl.SECURE_CONTAINER_BOSS)
            ) {
                for (const grid of item._props.Grids)
                {
                    if (grid._props.filters[0] === undefined) {
                        grid._props.filters = structuredClone(compatFiltersElement);
                    }
                }
            }
        }
    }

    createCase(container, caseConfig, tables){
        const handbook = tables.templates.handbook;
        const locales = Object.values(tables.locales.global) as Record<string, string>[];
        const itemID = caseConfig.id
        const itemPrefabPath = `CaseBundles/${itemID}.bundle`
        const templateId = this.newIdMap[itemID];
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        let item: any;

        //clone a case
        if (caseConfig.case_type === "container"){
            item = structuredClone(tables.templates.items[ItemTpl.CONTAINER_SICC]);
            item._props.IsAlwaysAvailableForInsurance = true;
            item._props.DiscardLimit = -1;
        }

        if (caseConfig.case_type === "slots"){
            item = structuredClone(tables.templates.items[ItemTpl.MOUNT_STRIKE_INDUSTRIES_KEYMOD_4_INCH_RAIL]);
            item._props.IsAlwaysAvailableForInsurance = true;
            item._props.DiscardLimit = -1;
            item._props.ItemSound = caseConfig.sound;
        }

        item._name = caseConfig.item_name;
        item._id = templateId;
        item._props.Prefab.path = itemPrefabPath;

        //call methods to set the grid or slot cells up
        if (caseConfig.case_type === "container"){
            item._props.Grids = this.createGrid(container, templateId, caseConfig);
        }
        if (caseConfig.case_type === "slots"){
            item._props.Slots = this.createSlot(container, templateId, caseConfig);
        }
        
        //set external size of the container:
        item._props.Width = caseConfig.ExternalSize.width;
        item._props.Height = caseConfig.ExternalSize.height;

        tables.templates.items[templateId] = item;
        
        //add locales
        for (const locale of locales) {
            locale[`${templateId} Name`] = caseConfig.item_name;
            locale[`${templateId} ShortName`] = caseConfig.item_short_name;
            locale[`${templateId} Description`] = caseConfig.item_description;
        }

        item._props.CanSellOnRagfair = !this.config.cases_flea_banned;
        item._props.InsuranceDisabled = !this.config.cases_insurance_enabled;
        const price = caseConfig.flea_price

        handbook.Items.push(
            {
                Id: templateId,
                ParentId: this.HANDBOOK_GEARCASES,
                Price: price
            }
        );

        //allow or disallow in secure containers, backpacks, other specific items per the config
        this.allowIntoContainers(
            templateId,
            tables.templates.items
        );

        this.pushToTrader(caseConfig, templateId, tables.traders);
    }

    pushToTrader(caseConfig, itemID:string, dbTraders: Record<string, ITrader>){
        const traderIDs = {
            mechanic: Traders.MECHANIC,
            skier: Traders.SKIER,
            peacekeeper: Traders.PEACEKEEPER,
            therapist: Traders.THERAPIST,
            prapor: Traders.PRAPOR,
            jaeger: Traders.JAEGER,
            ragman: Traders.RAGMAN
        };

        //add to config trader's inventory
        let traderToPush = caseConfig.trader;
        for (const [key, val] of Object.entries(traderIDs))
        {
            if (key === caseConfig.trader){
                traderToPush = val;
            }
        }
        const trader = dbTraders[traderToPush];

        trader.assort.items.push({
            _id: itemID,
            _tpl: itemID,
            parentId: "hideout",
            slotId: "hideout",
            upd:
            {
                UnlimitedCount: caseConfig.unlimited_stock,
                StackObjectsCount: caseConfig.stock_amount
            }
        });

        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        const barterTrade: any = [];
        const configBarters = caseConfig.barter;

        for (const barter in configBarters){
            barterTrade.push(configBarters[barter]);
        }

        trader.assort.barter_scheme[itemID] = [barterTrade];
        trader.assort.loyal_level_items[itemID] = caseConfig.trader_loyalty_level;
    }

    allowIntoContainers(itemID, items: Record<string, ITemplateItem>): void {
        for (const [_, item] of Object.entries(items)){
            // Skip non-items
            if (item._type !== "Item") continue;
            
            //disallow in backpacks
            if (!this.config.allow_in_backpacks){
                this.allowOrDisallowIntoCaseByParent(itemID, "exclude", item, BaseClasses.BACKPACK);
            }

            //allow in secure containers
            if (this.config.allow_in_secure_containers){
                this.allowOrDisallowIntoCaseByParent(itemID, "include", item, BaseClasses.MOB_CONTAINER);
            }

            //disallow in additional specific items
            for (const configItem in this.config.case_disallowed_in){
                if (this.config.case_disallowed_in[configItem] === item._id){
                    this.allowOrDisallowIntoCaseByID(itemID, "exclude", item);
                }

            }

            //allow in additional specific items
            for (const configItem in this.config.case_allowed_in){
                if (this.config.case_allowed_in[configItem] === item._id){
                    this.allowOrDisallowIntoCaseByID(itemID, "include", item);
                }
            }

            // Allow in special slots
            if (this.config.allow_cases_in_special && (item._id === ItemTpl.POCKETS_1X4_SPECIAL || item._id === ItemTpl.POCKETS_1X4_TUE)){
                this.allowInSpecialSlots(itemID, item);
                this.allowInSpecialSlots(itemID, item);
            }
        }
    }

    allowOrDisallowIntoCaseByParent(customItemID, includeOrExclude, currentItem, caseParent): void {
        // Skip if the parent isn't our case parent
        if (currentItem._parent !== caseParent || currentItem._id === ItemTpl.SECURE_CONTAINER_BOSS)
        {
            return;
        }

        if (includeOrExclude === "exclude") {
            for (const grid of currentItem._props.Grids) {
                if (grid._props.filters[0].ExcludedFilter === undefined) {
                    grid._props.filters[0].ExcludedFilter = [customItemID];
                } else {                 
                    grid._props.filters[0].ExcludedFilter.push(customItemID)
                }
            }
        }

        if (includeOrExclude === "include") {
            for (const grid of currentItem._props.Grids) {
                if (grid._props.filters[0].Filter === undefined) {
                    grid._props.filters[0].Filter = [customItemID];
                } else {
                    grid._props.filters[0].Filter.push(customItemID)
                }
            }
        }
    }

    allowOrDisallowIntoCaseByID(customItemID, includeOrExclude, currentItem): void {
    
        //exclude custom case in specific item of caseToApplyTo id
        if (includeOrExclude === "exclude"){
            for (const grid of currentItem._props.Grids) {
                if (grid._props.filters[0].ExcludedFilter === undefined){
                    grid._props.filters[0].ExcludedFilter = [customItemID];
                } else {
                    grid._props.filters[0].ExcludedFilter.push(customItemID)
                }
            }
        }

        //include custom case in specific item of caseToApplyTo id
        if (includeOrExclude === "include"){
            for (const grid of currentItem._props.Grids) {
                if (grid._props.filters[0].Filter === undefined){
                    grid._props.filters[0].Filter = [customItemID];
                } else {
                    grid._props.filters[0].Filter.push(customItemID)
                }
            }
        }      
    }

    allowInSpecialSlots(customItemID, currentItem): void {
        for (const slot of currentItem._props.Slots) {
            slot._props.filters[0]?.Filter.push(customItemID);
        }
    }

    createGrid(container, itemID, config) {
        const grids = [];

        // Loop over all grids in the config
        for (let i = 0; i < config.Grids.length; i++) {
            const grid = config.Grids[i];
            const inFilt = this.replaceOldIdWithNewId(grid.included_filter ?? []);
            const exFilt = this.replaceOldIdWithNewId(grid.excluded_filter ?? []);
            const cellWidth = grid.width;
            const cellHeight = grid.height;

            // If there's no include filter, add all items
            if (inFilt.length === 0) {
                inFilt.push(BaseClasses.ITEM);
            }

            grids.push(this.generateGridColumn(container, itemID, `column${i}`, cellWidth, cellHeight, inFilt, exFilt));
        }

        return grids;
    }

    replaceOldIdWithNewId(entries)
    {
        const newIdKeys = Object.keys(this.newIdMap);
        for (let i = 0; i < entries.length; i++)
        {
            if (newIdKeys.includes(entries[i]))
            {
                entries[i] = this.newIdMap[entries[i]];
            }
        }

        return entries;
    }

    createSlot(container, itemID, config) {
        const slots = [];
        const configSlots = config.slot_ids;

        for (let i = 0; i < configSlots.length; i++){
            slots.push(this.generateSlotColumn(container, itemID, `mod_mount_${i}`, configSlots[i]));
        }
        return slots;
    }

    generateGridColumn(container: DependencyContainer, itemID, name, cellH, cellV, inFilt, exFilt) {
        const hashUtil = container.resolve<HashUtil>("HashUtil")
        return {
            _name: name,
            _id: hashUtil.generate(),
            _parent: itemID,
            _props: {
                filters: [
                    {
                        Filter: [...inFilt],
                        ExcludedFilter: [...exFilt]
                    }
                ],
                cellsH: cellH,
                cellsV: cellV,
                minCount: 0,
                maxCount: 0,
                maxWeight: 0,
                isSortingTable: false
            }
        };
    }

    generateSlotColumn(container: DependencyContainer, itemID, name, configSlot) {
        const hashUtil = container.resolve<HashUtil>("HashUtil")
        return {
            _name: name,
            _id: hashUtil.generate(),
            _parent: itemID,
            _props: {
                filters: [
                    {
                        Filter: [configSlot],
                        ExcludedFilter: []
                    }
                ],
                _required: false,
                _mergeSlotWithChildren: false
            }
        };
    }

    // Handle updating the user profile between versions:
    // - Update the container IDs to the new MongoID format
    // - Look for any key cases in the user's inventory, and properly update the child key locations if we've moved them
    fixProfile(sessionId: string) {
        const databaseServer = this.container.resolve<DatabaseServer>("DatabaseServer");
        const dbTables = databaseServer.getTables();
        const dbItems = dbTables.templates.items;

        const pmcProfile = this.profileHelper.getFullProfile(sessionId)?.characters?.pmc;

        // Do nothing if the profile isn't initialized
        if (!pmcProfile?.Inventory?.items) return;

        // Update the container IDs to the new MongoID format
        for (const item of pmcProfile.Inventory.items)
        {
            if (this.newIdMap[item._tpl])
            {
                item._tpl = this.newIdMap[item._tpl];
            }
        }

        // Backup the PMC inventory
        const pmcInventory = structuredClone(pmcProfile.Inventory.items);

        // Look for any key cases in the user's inventory, and properly update the child key locations if we've moved them
        for (const caseName of Object.keys(cases))
        {
            const caseConfig = cases[caseName];

            if (caseConfig.case_type === "slots" && !this.fixSlotCase(caseConfig, dbItems, pmcProfile)) {
                pmcProfile.Inventory.items = pmcInventory;
                return;
            }

            if (caseConfig.case_type === "container" && !this.fixContainerCase(caseConfig, dbItems, pmcProfile)) {
                pmcProfile.Inventory.items = pmcInventory;
                return;
            }
        }
    }

    fixSlotCase(caseConfig, dbItems, pmcProfile) {
        const templateId = this.newIdMap[caseConfig.id];

        // Get the template for the case
        const caseTemplate = dbItems[templateId];

        // Try to find the case in the user's profile
        const inventoryCases = pmcProfile.Inventory.items.filter(x => x._tpl === templateId);

        for (const inventoryCase of inventoryCases)
        {
            const caseChildren = pmcProfile.Inventory.items.filter(x => x.parentId === inventoryCase._id);

            for (const child of caseChildren)
            {
                // Skip if the current slot filter can hold the given item, and there aren't multiple items in it
                const currentSlot = caseTemplate._props?.Slots?.find(x => x._name === child.slotId);
                if (currentSlot._props?.filters[0]?.Filter[0] === child._tpl &&
                    // A release of GKS went out that may have stacked keycards, so check for any stacked items in one slot
                    caseChildren.filter(x => x.slotId === currentSlot._name).length === 1
                )
                {
                    continue;
                }

                // Find a new slot, if this is a labs access item, find the first empty compatible slot
                const newSlot = caseTemplate._props?.Slots?.find(x => 
                    x._props?.filters[0]?.Filter[0] === child._tpl &&
                    // A release of GKS went out that may have stacked keycards, try to fix that
                    (
                        child._tpl !== ItemTpl.KEYCARD_TERRAGROUP_LABS_ACCESS || 
                        !caseChildren.find(y => y.slotId === x._name)
                    )
                );

                // If we couldn't find a new slot for this key, something has gone horribly wrong, restore the inventory and exit
                if (!newSlot)
                {
                    this.logger.error(`[${this.modName}] : ERROR: Unable to find new slot for ${child._tpl}. Restoring inventory and exiting`);
                    return false;
                }

                if (newSlot._name !== child.slotId)
                {
                    this.logger.debug(`[${this.modName}] : Need to move ${child.slotId} to ${newSlot._name}`);
                    child.slotId = newSlot._name;
                }
            }
        }

        return true;
    }

    fixContainerCase(caseConfig, dbItems, pmcProfile) {
        const templateId = this.newIdMap[caseConfig.id];

        // Get the template for the case
        const caseTemplate = dbItems[templateId];

        // Try to find the case in the user's profile
        const inventoryCases = pmcProfile.Inventory.items.filter(x => x._tpl === templateId);

        for (const inventoryCase of inventoryCases)
        {
            const caseChildren = pmcProfile.Inventory.items.filter(x => x.parentId === inventoryCase._id);

            for (const child of caseChildren)
            {
                // Skip if the item already has a location property
                if (child.location) {
                    continue;
                }

                // Find which grid the item should be in
                const newGrid = caseTemplate._props?.Grids?.find(x => 
                    x._props?.filters[0]?.Filter?.includes(child._tpl)
                );

                if (!newGrid) {
                    this.logger.error(`[${this.modName}] : ERROR: Unable to find new grid for ${child._tpl}. Restoring inventory and exiting`);
                    return false;
                }

                // Find the first free slot in that grid, assume everything is a 1x1 item
                let newX = -1;
                let newY = -1;
                for (let y = 0; y < newGrid._props.cellsV && newY < 0; y++)
                {
                    for (let x = 0; x < newGrid._props.cellsH && newX < 0; x++)
                    {
                        if (!caseChildren.find(item => item.location?.x == x && item.location?.y == y)) {
                            newX = x;
                            newY = y;
                        }
                    }
                }

                if (newX == -1 || newY == -1) {
                    this.logger.error(`[${this.modName}] : ERROR: Unable to find new location for ${child._tpl}. Restoring inventory and exiting`);
                    return false;
                }

                this.logger.debug(`[${this.modName}] : Need to move ${child.slotId} to ${newGrid._name} X: ${newX} Y: ${newY}`);

                // Update the child item to the new location
                child.location = {
                    "x": newX,
                    "y": newY,
                    "r": "Horizontal"
                };
                child.slotId = newGrid._name;
            }
        }

        return true;
    }
}

module.exports = { mod: new Mod() }
