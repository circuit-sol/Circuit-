// app/lib/productionGuide.ts

export interface ProductionPlannerParams {
  collectionName: string;
  brandName: string;
  guideDate?: string;
  productionWindow?: string;
  targetCompletion?: string;
  totalUnitsPlanned: number;
  fabricSpec?: string;
  embroiderySpec?: string;
  headpieceSpec?: string;
  pickupLocation?: string;
  orders?: Array<{
    id: string;
    order_number?: number | string;
    size?: string;
    quantity?: number;
    color?: string;
    notes?: string;
    pickup_location?: string;
    required_by?: string;
    stage?: string;
    garment_serial?: string | number;
  }>;
}

/**
 * Downloads the clean sample Circuit Collection Production Guide workbook (.xlsx)
 */
export function downloadOfficialProductionGuide() {
  if (typeof window === 'undefined') return;
  const link = document.createElement('a');
  link.href = '/Circuit_Collection_Production_Guide.xlsx';
  link.download = 'Circuit_Collection_Production_Guide.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generates and downloads a custom, fully styled Microsoft Excel spreadsheet (.xls / SpreadsheetML)
 * from the Creator Dashboard, matching the exact Circuit Collection Production Guide layout.
 */
export function exportProductionPlannerExcel(params: ProductionPlannerParams) {
  if (typeof window === 'undefined') return;

  const todayStr = params.guideDate || new Date().toISOString().split('T')[0];
  const collectionTitle = params.collectionName || 'Circuit Atelier Collection';
  const brandTitle = params.brandName || 'Circuit Atelier';
  const targetDate = params.targetCompletion || 'TBD';
  const windowStr = params.productionWindow || 'Batch Active';
  const totalUnits = params.totalUnitsPlanned || 50;

  // Build rows from orders or provide placeholder rows
  const rows: Array<{
    done: string;
    item: string;
    sku: string;
    size: string;
    quantity: number;
    colour: string;
    specs: string;
    location: string;
    requiredBy: string;
    stage: string;
  }> = [];

  const specsSummary = [
    params.fabricSpec ? `Fabric: ${params.fabricSpec}` : '',
    params.embroiderySpec ? `Embroidery: ${params.embroiderySpec}` : '',
    params.headpieceSpec ? `Headpiece: ${params.headpieceSpec}` : '',
  ].filter(Boolean).join(' | ') || 'Standard Atelier Bespoke Cut';

  if (params.orders && params.orders.length > 0) {
    params.orders.forEach((ord, idx) => {
      const serialLabel = ord.garment_serial ? `#${ord.garment_serial}` : `#${String(ord.order_number || idx + 1).padStart(2, '0')}`;
      rows.push({
        done: '☐',
        item: collectionTitle,
        sku: `CRCT-${ord.id ? ord.id.slice(0, 8).toUpperCase() : `UNIT-${idx + 1}`} (${serialLabel})`,
        size: ord.size || 'M',
        quantity: ord.quantity || 1,
        colour: ord.color || 'Duchess Satin / Core Black',
        specs: ord.notes || specsSummary,
        location: ord.pickup_location || params.pickupLocation || 'Circuit Station',
        requiredBy: ord.required_by || targetDate,
        stage: ord.stage || 'In Production / Cutting',
      });
    });
  } else {
    // Generate default size run matching the collection capacity
    const sizes = ['Small', 'Medium', 'Large', 'Extra Large'];
    sizes.forEach((sz, idx) => {
      rows.push({
        done: '☐',
        item: collectionTitle,
        sku: `CRCT-SKU-00${idx + 1}`,
        size: sz,
        quantity: Math.max(1, Math.floor(totalUnits / 4)),
        colour: 'Atelier Core Palette',
        specs: specsSummary,
        location: params.pickupLocation || 'Circuit Station',
        requiredBy: targetDate,
        stage: 'Scheduled for Cutting',
      });
    });
    // Add empty entry rows for designer workshop manual entry
    for (let i = 0; i < 6; i++) {
      rows.push({
        done: '☐',
        item: collectionTitle,
        sku: '',
        size: '',
        quantity: 0,
        colour: '',
        specs: '',
        location: params.pickupLocation || 'Circuit Station',
        requiredBy: targetDate,
        stage: 'Planning',
      });
    }
  }

  // Generate Microsoft Excel SpreadsheetML XML matching sample layout
  const excelXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <!-- Main Title Banner: Navy Blue, White Bold Centered -->
  <Style ss:ID="MainTitleBanner">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0B1A30"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="15" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#18335C" ss:Pattern="Solid"/>
  </Style>
  <!-- Section Subheader: Navy Blue -->
  <Style ss:ID="SectionHeader">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:Indent="1"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#18335C" ss:Pattern="Solid"/>
  </Style>
  <!-- Table Header Columns: Navy Blue, White Bold Centered with White borders -->
  <Style ss:ID="TableHeader">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FFFFFF"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#2A4B7C"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#2A4B7C"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#2A4B7C"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#18335C" ss:Pattern="Solid"/>
  </Style>
  <!-- Meta Labels and Values -->
  <Style ss:ID="MetaLabel">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000" ss:Bold="1"/>
  </Style>
  <Style ss:ID="MetaValue">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#18335C" ss:Bold="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>
   </Borders>
  </Style>
  <!-- Data Row Normal -->
  <Style ss:ID="DataCell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="DataCellCenter">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="CheckboxCell">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9D9D9"/>
   </Borders>
   <Font ss:FontName="Calibri" ss:Size="12" ss:Color="#18335C" ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Production Guide">
  <Table ss:DefaultRowHeight="20">
   <Column ss:Width="45"/>
   <Column ss:Width="140"/>
   <Column ss:Width="130"/>
   <Column ss:Width="60"/>
   <Column ss:Width="60"/>
   <Column ss:Width="110"/>
   <Column ss:Width="200"/>
   <Column ss:Width="130"/>
   <Column ss:Width="95"/>
   <Column ss:Width="110"/>

   <!-- Row 1: Header Banner (spans A through J) -->
   <Row ss:Height="34">
    <Cell ss:MergeAcross="9" ss:StyleID="MainTitleBanner">
     <Data ss:Type="String">CIRCUIT | COLLECTION PRODUCTION GUIDE</Data>
    </Cell>
   </Row>

   <!-- Row 2: Spacer -->
   <Row ss:Height="6"/>

   <!-- Row 3: Collection Name & Date -->
   <Row ss:Height="24">
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Collection name:</Data></Cell>
    <Cell ss:MergeAcross="4" ss:StyleID="MetaValue"><Data ss:Type="String">${escapeXml(collectionTitle)}</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Guide date:</Data></Cell>
    <Cell ss:MergeAcross="1" ss:StyleID="MetaValue"><Data ss:Type="String">${escapeXml(todayStr)}</Data></Cell>
   </Row>

   <!-- Row 4: Spacer -->
   <Row ss:Height="6"/>

   <!-- Row 5: Metadata Row -->
   <Row ss:Height="22">
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Brand:</Data></Cell>
    <Cell ss:MergeAcross="1" ss:StyleID="MetaValue"><Data ss:Type="String">${escapeXml(brandTitle)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Production:</Data></Cell>
    <Cell ss:MergeAcross="1" ss:StyleID="MetaValue"><Data ss:Type="String">${escapeXml(windowStr)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Target completion:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="String">${escapeXml(targetDate)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Total units:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${totalUnits}</Data></Cell>
   </Row>

   <!-- Row 6: Spacer -->
   <Row ss:Height="10"/>

   <!-- Row 7: Section Header Banner -->
   <Row ss:Height="24">
    <Cell ss:MergeAcross="9" ss:StyleID="SectionHeader">
     <Data ss:Type="String">PRODUCTION TRACKER</Data>
    </Cell>
   </Row>

   <!-- Row 8: Table Column Headers (10 columns) -->
   <Row ss:Height="26">
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Done ✓</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Item / Style</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Order / SKU</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Size</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Quantity</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Colour</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Production notes / specs</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Pickup location</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Required by</Data></Cell>
    <Cell ss:StyleID="TableHeader"><Data ss:Type="String">Stage</Data></Cell>
   </Row>

   <!-- Data Rows -->
   ${rows.map(r => `
   <Row ss:Height="22">
    <Cell ss:StyleID="CheckboxCell"><Data ss:Type="String">${r.done}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.item)}</Data></Cell>
    <Cell ss:StyleID="DataCellCenter"><Data ss:Type="String">${escapeXml(r.sku)}</Data></Cell>
    <Cell ss:StyleID="DataCellCenter"><Data ss:Type="String">${escapeXml(r.size)}</Data></Cell>
    <Cell ss:StyleID="DataCellCenter"><Data ss:Type="${r.quantity > 0 ? 'Number' : 'String'}">${r.quantity > 0 ? r.quantity : ''}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.colour)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.specs)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.location)}</Data></Cell>
    <Cell ss:StyleID="DataCellCenter"><Data ss:Type="String">${escapeXml(r.requiredBy)}</Data></Cell>
    <Cell ss:StyleID="DataCellCenter"><Data ss:Type="String">${escapeXml(r.stage)}</Data></Cell>
   </Row>`).join('')}

  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <PageSetup>
    <Layout x:Orientation="Landscape"/>
   </PageSetup>
   <FitToPage/>
   <Print>
    <FitWidth>1</FitWidth>
    <FitHeight>100</FitHeight>
   </Print>
   <Selected/>
   <ProtectObjects>False</ProtectObjects>
   <ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([excelXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeFilename = collectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  a.href = url;
  a.download = `Circuit_Production_Guide_${safeFilename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
